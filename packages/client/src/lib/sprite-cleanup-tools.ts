export interface WandResult {
  removed: number;
  target: Rgba;
}

export interface CanvasPoint {
  x: number;
  y: number;
}

export type BrushMode = "erase" | "restore" | "blur";

type Rgb = [number, number, number];
export type Rgba = [number, number, number, number];
export type NeighborMode = "cardinal" | "all";

interface ConnectedSelection {
  selected: Uint8Array;
  target: Rgb;
  targetAlpha: number;
  totalPixels: number;
}

interface EdgeBand {
  edgeDistance: Uint8Array;
  edgeNormalX: Int8Array;
  edgeNormalY: Int8Array;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function clampUnit(value: number): number {
  return clamp(value, 0, 1);
}

function colorDistanceSquared(data: Uint8ClampedArray, offset: number, target: Rgb): number {
  const red = data[offset] - target[0];
  const green = data[offset + 1] - target[1];
  const blue = data[offset + 2] - target[2];
  return red * red + green * green + blue * blue;
}

export function cloneImageData(imageData: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
}

export function rgbaAt(imageData: ImageData, point: CanvasPoint): Rgba {
  const offset = (point.y * imageData.width + point.x) * 4;
  return [
    imageData.data[offset] ?? 0,
    imageData.data[offset + 1] ?? 0,
    imageData.data[offset + 2] ?? 0,
    imageData.data[offset + 3] ?? 0,
  ];
}

export function formatRgba(color: Rgba): string {
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${color[3]})`;
}

function readPixel(imageData: ImageData, index: number): Rgba {
  const offset = index * 4;
  return [
    imageData.data[offset] ?? 0,
    imageData.data[offset + 1] ?? 0,
    imageData.data[offset + 2] ?? 0,
    imageData.data[offset + 3] ?? 0,
  ];
}

function getEmptyWandResult(imageData: ImageData, startX: number, startY: number): WandResult {
  const target = readPixel(imageData, startY * imageData.width + startX);
  return { removed: 0, target };
}

function visitNeighbors(
  index: number,
  width: number,
  totalPixels: number,
  mode: NeighborMode,
  visit: (neighbor: number) => void,
) {
  const x = index % width;
  const hasLeft = x > 0;
  const hasRight = x < width - 1;
  const hasTop = index >= width;
  const hasBottom = index < totalPixels - width;

  if (hasLeft) visit(index - 1);
  if (hasRight) visit(index + 1);
  if (hasTop) {
    visit(index - width);
    if (mode === "all") {
      if (hasLeft) visit(index - width - 1);
      if (hasRight) visit(index - width + 1);
    }
  }
  if (hasBottom) {
    visit(index + width);
    if (mode === "all") {
      if (hasLeft) visit(index + width - 1);
      if (hasRight) visit(index + width + 1);
    }
  }
}

function selectConnectedRegion(
  imageData: ImageData,
  startX: number,
  startY: number,
  tolerance: number,
  mode: NeighborMode,
): ConnectedSelection | null {
  const { data, width, height } = imageData;
  const startIndex = startY * width + startX;
  const [red, green, blue, targetAlpha] = readPixel(imageData, startIndex);

  if (targetAlpha <= 8) return null;

  const target: Rgb = [red, green, blue];
  const totalPixels = width * height;
  const threshold = tolerance * tolerance;
  const selected = new Uint8Array(totalPixels);
  const visited = new Uint8Array(totalPixels);
  const stack = new Int32Array(totalPixels);
  let stackLength = 0;

  const pushPixel = (index: number) => {
    if (visited[index]) return;

    visited[index] = 1;
    const offset = index * 4;
    if (data[offset + 3] <= 8 || colorDistanceSquared(data, offset, target) > threshold) return;

    selected[index] = 1;
    stack[stackLength++] = index;
  };

  pushPixel(startIndex);

  while (stackLength > 0) {
    visitNeighbors(stack[--stackLength], width, totalPixels, mode, pushPixel);
  }

  return {
    selected,
    target,
    targetAlpha,
    totalPixels,
  };
}

function clearSelection(imageData: ImageData, selected: Uint8Array): number {
  const { data } = imageData;
  let removed = 0;

  for (let index = 0; index < selected.length; index += 1) {
    if (!selected[index]) continue;

    const offset = index * 4;
    const originalAlpha = data[offset + 3] ?? 0;
    data[offset + 3] = 0;
    if (originalAlpha !== 0) removed += 1;
  }

  return removed;
}

function buildEdgeBand(
  selected: Uint8Array,
  width: number,
  totalPixels: number,
  radius: number,
  mode: NeighborMode,
): EdgeBand {
  const edgeDistance = new Uint8Array(totalPixels);
  const edgeNormalX = new Int8Array(totalPixels);
  const edgeNormalY = new Int8Array(totalPixels);
  const edgeQueue = new Int32Array(totalPixels);
  let queueLength = 0;

  const pushEdgePixel = (index: number, nextDistance: number, normalX: number, normalY: number) => {
    if (selected[index] || edgeDistance[index] !== 0 || nextDistance > radius) return;

    edgeDistance[index] = nextDistance;
    edgeNormalX[index] = Math.sign(normalX);
    edgeNormalY[index] = Math.sign(normalY);
    edgeQueue[queueLength++] = index;
  };

  for (let index = 0; index < totalPixels; index += 1) {
    if (!selected[index]) continue;

    const selectedX = index % width;
    const selectedY = Math.floor(index / width);
    visitNeighbors(index, width, totalPixels, mode, (neighbor) => {
      const neighborX = neighbor % width;
      const neighborY = Math.floor(neighbor / width);
      pushEdgePixel(neighbor, 1, neighborX - selectedX, neighborY - selectedY);
    });
  }

  for (let queueIndex = 0; queueIndex < queueLength; queueIndex += 1) {
    const index = edgeQueue[queueIndex];
    const nextDistance = edgeDistance[index] + 1;
    if (nextDistance > radius) continue;

    const normalX = edgeNormalX[index] ?? 0;
    const normalY = edgeNormalY[index] ?? 0;
    visitNeighbors(index, width, totalPixels, mode, (neighbor) => pushEdgePixel(neighbor, nextDistance, normalX, normalY));
  }

  return { edgeDistance, edgeNormalX, edgeNormalY };
}

function buildSelectedEdgeDistance(
  selected: Uint8Array,
  sourceData: Uint8ClampedArray,
  width: number,
  totalPixels: number,
  radius: number,
  mode: NeighborMode,
): Uint8Array {
  const edgeDistance = new Uint8Array(totalPixels);
  const edgeQueue = new Int32Array(totalPixels);
  let queueLength = 0;

  const pushSelectedPixel = (index: number, nextDistance: number) => {
    if (!selected[index] || edgeDistance[index] !== 0 || nextDistance > radius) return;

    edgeDistance[index] = nextDistance;
    edgeQueue[queueLength++] = index;
  };

  for (let index = 0; index < totalPixels; index += 1) {
    if (!selected[index]) continue;

    let touchesKeptOpaquePixel = false;
    visitNeighbors(index, width, totalPixels, mode, (neighbor) => {
      if (selected[neighbor]) return;

      const neighborAlpha = sourceData[neighbor * 4 + 3] ?? 0;
      if (neighborAlpha > 8) touchesKeptOpaquePixel = true;
    });

    if (touchesKeptOpaquePixel) pushSelectedPixel(index, 1);
  }

  for (let queueIndex = 0; queueIndex < queueLength; queueIndex += 1) {
    const index = edgeQueue[queueIndex];
    const nextDistance = edgeDistance[index] + 1;
    if (nextDistance > radius) continue;

    visitNeighbors(index, width, totalPixels, mode, (neighbor) => pushSelectedPixel(neighbor, nextDistance));
  }

  return edgeDistance;
}

export function removeConnectedColor(
  imageData: ImageData,
  startX: number,
  startY: number,
  tolerance: number,
  mode: NeighborMode = "cardinal",
): WandResult {
  const selection = selectConnectedRegion(imageData, startX, startY, tolerance, mode);
  if (!selection) return getEmptyWandResult(imageData, startX, startY);

  return {
    removed: clearSelection(imageData, selection.selected),
    target: [selection.target[0], selection.target[1], selection.target[2], selection.targetAlpha],
  };
}

export function removeConnectedColorSoftEdge(
  imageData: ImageData,
  startX: number,
  startY: number,
  tolerance: number,
  featherStrength: number,
  blendStrength: number,
): WandResult {
  const { data, width, height } = imageData;
  const featherAmount = clampUnit(featherStrength / 100);
  const blendAmount = clampUnit(blendStrength / 100);
  const softTolerance = Math.min(160, Math.round(tolerance * (1.1 + featherAmount * 0.22)));
  const selection = selectConnectedRegion(imageData, startX, startY, softTolerance, "all");
  if (!selection) return getEmptyWandResult(imageData, startX, startY);

  const haloRadius = featherAmount <= 0 ? 0 : 1 + Math.round(featherAmount * 2.25);
  const { selected, target, targetAlpha, totalPixels } = selection;
  const sourceData = new Uint8ClampedArray(data);
  const selectedEdgeDistance = buildSelectedEdgeDistance(selected, sourceData, width, totalPixels, haloRadius, "all");
  let removed = clearSelection(imageData, selected);

  if (haloRadius > 0 && blendAmount > 0) {
    const findHaloNeighborColor = (index: number): Rgb | null => {
      const x = index % width;
      const y = Math.floor(index / width);
      const sampleRadius = 3 + Math.round(featherAmount * 3);
      let redTotal = 0;
      let greenTotal = 0;
      let blueTotal = 0;
      let weightTotal = 0;

      for (let yOffset = -sampleRadius; yOffset <= sampleRadius; yOffset += 1) {
        const sampleY = y + yOffset;
        if (sampleY < 0 || sampleY >= height) continue;

        for (let xOffset = -sampleRadius; xOffset <= sampleRadius; xOffset += 1) {
          if (xOffset === 0 && yOffset === 0) continue;

          const sampleDistance = Math.hypot(xOffset, yOffset);
          if (sampleDistance > sampleRadius) continue;

          const sampleX = x + xOffset;
          if (sampleX < 0 || sampleX >= width) continue;

          const sampleIndex = sampleY * width + sampleX;
          if (selected[sampleIndex]) continue;

          const sampleOffset = sampleIndex * 4;
          const alpha = sourceData[sampleOffset + 3] ?? 0;
          if (alpha <= 36) continue;

          const targetDistance = Math.sqrt(colorDistanceSquared(sourceData, sampleOffset, target));
          const matteSeparation = clampUnit((targetDistance - tolerance * 0.45) / Math.max(1, tolerance * 1.65));
          if (matteSeparation <= 0) continue;

          const red = sourceData[sampleOffset] ?? 0;
          const green = sourceData[sampleOffset + 1] ?? 0;
          const blue = sourceData[sampleOffset + 2] ?? 0;
          const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722;
          const lightBias = 0.18 + Math.pow(clampUnit((luma - 32) / 223), 2.6) * 4.4;
          const weight =
            (Math.pow(alpha / 255, 1.35) * Math.pow(matteSeparation, 1.2) * lightBias) /
            Math.max(1, sampleDistance);

          redTotal += red * weight;
          greenTotal += green * weight;
          blueTotal += blue * weight;
          weightTotal += weight;
        }
      }

      if (weightTotal <= 0) return null;

      return [
        Math.round(redTotal / weightTotal),
        Math.round(greenTotal / weightTotal),
        Math.round(blueTotal / weightTotal),
      ];
    };

    const maxHaloAlpha = 14 + featherAmount * 46;

    for (let index = 0; index < totalPixels; index += 1) {
      if (!selected[index]) continue;

      const distanceFromCut = selectedEdgeDistance[index] ?? 0;
      if (distanceFromCut === 0) continue;

      const foregroundColor = findHaloNeighborColor(index);
      if (!foregroundColor) continue;

      const offset = index * 4;
      const edgePosition = clampUnit((haloRadius - distanceFromCut + 1) / Math.max(1, haloRadius));
      const haloAlpha = Math.round(maxHaloAlpha * blendAmount * Math.pow(edgePosition, 1.55));
      if (haloAlpha <= 0) continue;

      data[offset] = foregroundColor[0];
      data[offset + 1] = foregroundColor[1];
      data[offset + 2] = foregroundColor[2];
      data[offset + 3] = Math.min(sourceData[offset + 3] ?? 255, haloAlpha);
    }
  }

  return {
    removed,
    target: [target[0], target[1], target[2], targetAlpha],
  };
}

export function removeConnectedColorDecontaminate(
  imageData: ImageData,
  startX: number,
  startY: number,
  tolerance: number,
  decontaminateStrength: number,
  featherStrength: number,
): WandResult {
  const { data, width, height } = imageData;
  const decontaminateAmount = clampUnit(decontaminateStrength / 100);
  const featherAmount = clampUnit(featherStrength / 100);
  const edgeStrength = Math.pow(decontaminateAmount, 0.72);
  const selectionTolerance = Math.min(176, Math.round(tolerance * 1.24));
  const selection = selectConnectedRegion(imageData, startX, startY, selectionTolerance, "all");
  if (!selection) return getEmptyWandResult(imageData, startX, startY);

  const { selected, target, targetAlpha, totalPixels } = selection;
  const edgeRadius = 1 + Math.round(featherAmount * 7);
  const matteTolerance = Math.min(244, Math.round(tolerance * (1.55 + edgeStrength * 0.7 + featherAmount * 0.25)));
  const foregroundSearchRadius = 3 + edgeRadius + Math.round(edgeStrength * 2);
  const sourceData = new Uint8ClampedArray(data);
  const { edgeDistance, edgeNormalX, edgeNormalY } = buildEdgeBand(selected, width, totalPixels, edgeRadius, "all");
  let removed = clearSelection(imageData, selected);
  const findForegroundNeighborColor = (index: number): Rgb | null => {
    const x = index % width;
    const y = Math.floor(index / width);
    const normalX = edgeNormalX[index] ?? 0;
    const normalY = edgeNormalY[index] ?? 0;
    const currentDistance = edgeDistance[index] ?? 0;

    const sample = (directional: boolean): Rgb | null => {
      let redTotal = 0;
      let greenTotal = 0;
      let blueTotal = 0;
      let weightTotal = 0;

      for (let yOffset = -foregroundSearchRadius; yOffset <= foregroundSearchRadius; yOffset += 1) {
        const sampleY = y + yOffset;
        if (sampleY < 0 || sampleY >= height) continue;

        for (let xOffset = -foregroundSearchRadius; xOffset <= foregroundSearchRadius; xOffset += 1) {
          if (xOffset === 0 && yOffset === 0) continue;

          const sampleDistance = Math.hypot(xOffset, yOffset);
          if (sampleDistance > foregroundSearchRadius) continue;

          const dot = xOffset * normalX + yOffset * normalY;
          if (directional && (normalX !== 0 || normalY !== 0) && dot <= 0) continue;

          const sampleX = x + xOffset;
          if (sampleX < 0 || sampleX >= width) continue;

          const sampleIndex = sampleY * width + sampleX;
          if (selected[sampleIndex]) continue;

          const sampleEdgeDistance = edgeDistance[sampleIndex] ?? 0;
          if (sampleEdgeDistance > 0 && sampleEdgeDistance <= currentDistance) continue;

          const sampleOffset = sampleIndex * 4;
          const alpha = sourceData[sampleOffset + 3] ?? 0;
          if (alpha <= 40) continue;

          const targetDistance = Math.sqrt(colorDistanceSquared(sourceData, sampleOffset, target));
          if (alpha < 220 && targetDistance < selectionTolerance * 0.8) continue;

          const directionWeight = directional
            ? 1 + clampUnit(dot / Math.max(1, foregroundSearchRadius)) * 1.6
            : 1;
          const alphaWeight = Math.pow(alpha / 255, 2.2);
          const colorSeparationWeight = 0.7 + clampUnit(targetDistance / Math.max(1, matteTolerance)) * 0.6;
          const weight = (alphaWeight * colorSeparationWeight * directionWeight) / Math.max(1, sampleDistance);
          redTotal += (sourceData[sampleOffset] ?? 0) * weight;
          greenTotal += (sourceData[sampleOffset + 1] ?? 0) * weight;
          blueTotal += (sourceData[sampleOffset + 2] ?? 0) * weight;
          weightTotal += weight;
        }
      }

      if (weightTotal <= 0) return null;
      return [
        Math.round(redTotal / weightTotal),
        Math.round(greenTotal / weightTotal),
        Math.round(blueTotal / weightTotal),
      ];
    };

    return sample(true) ?? sample(false);
  };

  for (let index = 0; index < totalPixels; index += 1) {
    if (selected[index]) continue;

    const offset = index * 4;
    const originalAlpha = sourceData[offset + 3] ?? 0;

    const distanceFromCut = edgeDistance[index];
    if (distanceFromCut === 0 || decontaminateAmount <= 0 || originalAlpha <= 8) continue;

    const targetDistance = Math.sqrt(colorDistanceSquared(sourceData, offset, target));
    const matteSimilarity = targetDistance <= matteTolerance ? 1 - targetDistance / matteTolerance : 0;
    const foregroundColor = findForegroundNeighborColor(index);
    const originalRed = sourceData[offset] ?? 0;
    const originalGreen = sourceData[offset + 1] ?? 0;
    const originalBlue = sourceData[offset + 2] ?? 0;
    const foregroundDistance = foregroundColor
      ? Math.hypot(originalRed - foregroundColor[0], originalGreen - foregroundColor[1], originalBlue - foregroundColor[2])
      : 0;
    const foregroundMismatch = foregroundColor
      ? clampUnit((foregroundDistance - (14 - featherAmount * 8)) / (150 - featherAmount * 45))
      : 0;
    const alphaVulnerability = clampUnit((245 - originalAlpha) / (210 - featherAmount * 70));
    const edgePosition = clampUnit((edgeRadius - distanceFromCut + 1) / Math.max(1, edgeRadius));
    const proximity = Math.pow(edgePosition, 1.75 - featherAmount * 1.1);
    const cleanupWeight =
      Math.max(
        matteSimilarity * (0.88 + featherAmount * 0.18),
        foregroundMismatch,
        alphaVulnerability * (0.34 + featherAmount * 0.32),
      ) *
      proximity *
      edgeStrength *
      (0.75 + featherAmount * 0.45);

    if (cleanupWeight <= 0.01) continue;

    let nextRed = originalRed;
    let nextGreen = originalGreen;
    let nextBlue = originalBlue;

    if (foregroundColor) {
      const colorPull = clampUnit(cleanupWeight * (0.86 + edgeStrength * 0.32 + featherAmount * 0.28));
      nextRed = Math.round(originalRed * (1 - colorPull) + foregroundColor[0] * colorPull);
      nextGreen = Math.round(originalGreen * (1 - colorPull) + foregroundColor[1] * colorPull);
      nextBlue = Math.round(originalBlue * (1 - colorPull) + foregroundColor[2] * colorPull);
    }

    const alphaReduction =
      cleanupWeight *
      (0.06 + matteSimilarity * (0.15 + featherAmount * 0.2) + alphaVulnerability * (0.12 + featherAmount * 0.22));
    const nextAlpha = Math.min(
      originalAlpha,
      Math.round(originalAlpha * clamp(1 - alphaReduction, 0.62 - featherAmount * 0.24, 1)),
    );

    if (
      nextRed === originalRed &&
      nextGreen === originalGreen &&
      nextBlue === originalBlue &&
      nextAlpha === originalAlpha
    ) {
      continue;
    }

    data[offset] = nextRed;
    data[offset + 1] = nextGreen;
    data[offset + 2] = nextBlue;
    data[offset + 3] = nextAlpha;
    removed += 1;
  }

  if (featherAmount > 0 && decontaminateAmount > 0) {
    const smoothedSource = new Uint8ClampedArray(data);
    const blurRadius = 1 + Math.round(featherAmount * 2);
    const blurMixBase = featherAmount * (0.18 + edgeStrength * 0.56);

    for (let index = 0; index < totalPixels; index += 1) {
      if (selected[index]) continue;

      const distanceFromCut = edgeDistance[index];
      if (distanceFromCut === 0) continue;

      const offset = index * 4;
      const originalAlpha = smoothedSource[offset + 3] ?? 0;
      if (originalAlpha <= 8) continue;

      const x = index % width;
      const y = Math.floor(index / width);
      let alphaTotal = 0;
      let weightTotal = 0;
      let minAlpha = originalAlpha;
      let maxAlpha = originalAlpha;
      let touchesCut = false;

      for (let yOffset = -blurRadius; yOffset <= blurRadius; yOffset += 1) {
        const sampleY = y + yOffset;
        if (sampleY < 0 || sampleY >= height) continue;

        for (let xOffset = -blurRadius; xOffset <= blurRadius; xOffset += 1) {
          const sampleDistance = Math.hypot(xOffset, yOffset);
          if (sampleDistance > blurRadius) continue;

          const sampleX = x + xOffset;
          if (sampleX < 0 || sampleX >= width) continue;

          const sampleIndex = sampleY * width + sampleX;
          const sampleAlpha = selected[sampleIndex] ? 0 : (smoothedSource[sampleIndex * 4 + 3] ?? 0);
          const weight = xOffset === 0 && yOffset === 0 ? 1.75 : 1 / Math.max(1, sampleDistance);

          if (selected[sampleIndex]) touchesCut = true;
          minAlpha = Math.min(minAlpha, sampleAlpha);
          maxAlpha = Math.max(maxAlpha, sampleAlpha);
          alphaTotal += sampleAlpha * weight;
          weightTotal += weight;
        }
      }

      if ((!touchesCut && maxAlpha - minAlpha < 18) || weightTotal <= 0) continue;

      const averagedAlpha = Math.round(alphaTotal / weightTotal);
      if (averagedAlpha >= originalAlpha) continue;

      const targetDistance = Math.sqrt(colorDistanceSquared(smoothedSource, offset, target));
      const matteAttraction =
        targetDistance <= matteTolerance ? 0.35 + (1 - targetDistance / matteTolerance) * 0.65 : 0.35;
      const edgePosition = clampUnit((edgeRadius - distanceFromCut + 1) / Math.max(1, edgeRadius));
      const proximity = Math.pow(edgePosition, 0.55 + (1 - featherAmount) * 0.8);
      const blurMix = clampUnit(blurMixBase * matteAttraction * proximity);
      const nextAlpha = Math.min(originalAlpha, Math.round(originalAlpha * (1 - blurMix) + averagedAlpha * blurMix));

      if (nextAlpha === originalAlpha) continue;

      data[offset + 3] = nextAlpha;
      removed += 1;
    }
  }

  return {
    removed,
    target: [target[0], target[1], target[2], targetAlpha],
  };
}

export function applyBrushStamp(
  imageData: ImageData,
  originalImage: ImageData | null,
  centerX: number,
  centerY: number,
  radius: number,
  mode: BrushMode,
  eraserHardness: number,
  blurStrength: number,
): number {
  const { data, width, height } = imageData;
  const restoreSource = originalImage?.data ?? null;
  const blurSource = mode === "blur" ? new Uint8ClampedArray(data) : null;
  const eraserHardnessAmount = clampUnit(eraserHardness / 100);
  const blurAmount = clampUnit(blurStrength / 100);
  const minX = Math.max(0, Math.floor(centerX - radius));
  const maxX = Math.min(width - 1, Math.ceil(centerX + radius));
  const minY = Math.max(0, Math.floor(centerY - radius));
  const maxY = Math.min(height - 1, Math.ceil(centerY + radius));
  const radiusSquared = radius * radius;
  let changed = 0;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      if (dx * dx + dy * dy > radiusSquared) continue;

      const offset = (y * width + x) * 4;
      if (mode === "blur") {
        if (!blurSource || blurAmount <= 0) continue;

        const originalAlpha = blurSource[offset + 3] ?? 0;
        if (originalAlpha <= 8) continue;

        let minAlpha = originalAlpha;
        let maxAlpha = originalAlpha;
        let alphaTotal = 0;
        let weightTotal = 0;

        for (let sampleY = Math.max(0, y - 1); sampleY <= Math.min(height - 1, y + 1); sampleY += 1) {
          for (let sampleX = Math.max(0, x - 1); sampleX <= Math.min(width - 1, x + 1); sampleX += 1) {
            const sampleOffset = (sampleY * width + sampleX) * 4;
            const sampleAlpha = blurSource[sampleOffset + 3] ?? 0;
            const distance = Math.max(1, Math.hypot(sampleX - x, sampleY - y));
            const weight = sampleX === x && sampleY === y ? 1.75 : 1 / distance;

            minAlpha = Math.min(minAlpha, sampleAlpha);
            maxAlpha = Math.max(maxAlpha, sampleAlpha);
            alphaTotal += sampleAlpha * weight;
            weightTotal += weight;
          }
        }

        if (maxAlpha - minAlpha < 24 || weightTotal <= 0) continue;

        const averagedAlpha = Math.round(alphaTotal / weightTotal);
        const nextAlpha = Math.min(
          originalAlpha,
          Math.round(originalAlpha * (1 - blurAmount) + averagedAlpha * blurAmount),
        );
        if (nextAlpha === originalAlpha) continue;

        data[offset + 3] = nextAlpha;
        changed += 1;
        continue;
      }

      if (mode === "erase") {
        const originalAlpha = data[offset + 3] ?? 0;
        if (originalAlpha <= 0) continue;

        const normalizedDistance = Math.sqrt(dx * dx + dy * dy) / Math.max(1, radius);
        const hardCore = eraserHardnessAmount >= 0.99 ? 1 : Math.pow(eraserHardnessAmount, 1.35);
        const featherCurve = 1 + (1 - eraserHardnessAmount) * 1.8;
        const eraseAmount =
          normalizedDistance <= hardCore
            ? 1
            : Math.pow(clampUnit((1 - normalizedDistance) / Math.max(0.001, 1 - hardCore)), featherCurve);
        const nextAlpha = Math.round(originalAlpha * (1 - eraseAmount));
        if (nextAlpha === originalAlpha) continue;

        data[offset + 3] = nextAlpha;
        changed += 1;
        continue;
      }

      if (!restoreSource) continue;
      const red = restoreSource[offset] ?? 0;
      const green = restoreSource[offset + 1] ?? 0;
      const blue = restoreSource[offset + 2] ?? 0;
      const alpha = restoreSource[offset + 3] ?? 0;
      if (data[offset] === red && data[offset + 1] === green && data[offset + 2] === blue && data[offset + 3] === alpha) {
        continue;
      }
      data[offset] = red;
      data[offset + 1] = green;
      data[offset + 2] = blue;
      data[offset + 3] = alpha;
      changed += 1;
    }
  }

  return changed;
}

export function applyBrushLine(
  imageData: ImageData,
  originalImage: ImageData | null,
  from: CanvasPoint,
  to: CanvasPoint,
  radius: number,
  mode: BrushMode,
  eraserHardness: number,
  blurStrength: number,
): number {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(1, Math.ceil(distance / Math.max(1, radius * 0.45)));
  let changed = 0;

  for (let step = 1; step <= steps; step += 1) {
    const amount = step / steps;
    changed += applyBrushStamp(
      imageData,
      originalImage,
      from.x + (to.x - from.x) * amount,
      from.y + (to.y - from.y) * amount,
      radius,
      mode,
      eraserHardness,
      blurStrength,
    );
  }

  return changed;
}
