export interface WandResult {
  removed: number;
  target: Rgba;
}

export interface CanvasPoint {
  x: number;
  y: number;
}

export type BrushMode = "erase" | "restore" | "blur" | "clean";

type Rgb = [number, number, number];
export type Rgba = [number, number, number, number];
export type NeighborMode = "cardinal" | "all";
export type WandSelectionMode = "connected" | "local";

export interface WandCleanupOptions {
  mode: WandSelectionMode;
  radius: number;
  edgeGuard: number;
  expand: number;
  softness: number;
  feather: number;
}

export interface TargetCleanBrushOptions {
  target: Rgba;
  tolerance: number;
  edgeGuard: number;
  feather: number;
}

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

function offsetSelection(
  selected: Uint8Array,
  sourceData: Uint8ClampedArray,
  width: number,
  totalPixels: number,
  offset: number,
): Uint8Array {
  const steps = Math.min(8, Math.abs(Math.trunc(offset)));
  if (steps === 0) return selected;

  let current = new Uint8Array(selected);

  for (let step = 0; step < steps; step += 1) {
    const next = new Uint8Array(current);

    if (offset > 0) {
      for (let index = 0; index < totalPixels; index += 1) {
        if (!current[index]) continue;

        visitNeighbors(index, width, totalPixels, "all", (neighbor) => {
          if ((sourceData[neighbor * 4 + 3] ?? 0) <= 8) return;
          next[neighbor] = 1;
        });
      }
    } else {
      for (let index = 0; index < totalPixels; index += 1) {
        if (!current[index]) continue;

        let touchesOutside = false;
        visitNeighbors(index, width, totalPixels, "all", (neighbor) => {
          if (!current[neighbor]) touchesOutside = true;
        });

        if (touchesOutside) next[index] = 0;
      }
    }

    current = next;
  }

  return current;
}

function expandSelection(
  selected: Uint8Array,
  width: number,
  totalPixels: number,
  steps: number,
  canSelect: (index: number, toleranceBoost: number) => boolean,
): Uint8Array {
  const expandSteps = Math.min(4, Math.max(0, Math.trunc(steps)));
  if (expandSteps === 0) return selected;

  let current = new Uint8Array(selected);

  for (let step = 0; step < expandSteps; step += 1) {
    const next = new Uint8Array(current);
    const toleranceBoost = 1.08 + step * 0.08;

    for (let index = 0; index < totalPixels; index += 1) {
      if (!current[index]) continue;

      visitNeighbors(index, width, totalPixels, "all", (neighbor) => {
        if (current[neighbor] || !canSelect(neighbor, toleranceBoost)) return;
        next[neighbor] = 1;
      });
    }

    current = next;
  }

  return current;
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

function addSelectedMatteFeather(
  imageData: ImageData,
  selected: Uint8Array,
  sourceData: Uint8ClampedArray,
  featherStrength: number,
  maxAlpha = 86,
  radiusScale = 4,
): number {
  const { data, width } = imageData;
  const featherAmount = clampUnit(featherStrength / 100);
  if (featherAmount <= 0) return 0;

  const totalPixels = selected.length;
  const featherRadius = 1 + Math.round(featherAmount * radiusScale);
  const selectedEdgeDistance = buildSelectedEdgeDistance(selected, sourceData, width, totalPixels, featherRadius, "all");
  const maxFeatherAlpha = 4 + featherAmount * Math.max(0, maxAlpha - 4);
  let changed = 0;

  for (let index = 0; index < totalPixels; index += 1) {
    if (!selected[index]) continue;

    const distanceFromCut = selectedEdgeDistance[index] ?? 0;
    if (distanceFromCut === 0) continue;

    const offset = index * 4;
    const sourceAlpha = sourceData[offset + 3] ?? 0;
    if (sourceAlpha <= 0) continue;

    const edgePosition = clampUnit((featherRadius - distanceFromCut + 1) / Math.max(1, featherRadius));
    const featherAlpha = Math.min(sourceAlpha, Math.round(maxFeatherAlpha * Math.pow(edgePosition, 1.35)));
    if (featherAlpha <= 0) continue;

    const nextRed = sourceData[offset] ?? 0;
    const nextGreen = sourceData[offset + 1] ?? 0;
    const nextBlue = sourceData[offset + 2] ?? 0;
    if (
      data[offset] === nextRed &&
      data[offset + 1] === nextGreen &&
      data[offset + 2] === nextBlue &&
      data[offset + 3] === featherAlpha
    ) {
      continue;
    }

    data[offset] = nextRed;
    data[offset + 1] = nextGreen;
    data[offset + 2] = nextBlue;
    data[offset + 3] = featherAlpha;
    changed += 1;
  }

  return changed;
}

function addSelectedSoftHalo(
  imageData: ImageData,
  selected: Uint8Array,
  sourceData: Uint8ClampedArray,
  target: Rgb,
  tolerance: number,
  feather: number,
  softness: number,
): number {
  const { data, width, height } = imageData;
  const featherAmount = clampUnit(feather / 100);
  const softnessAmount = clampUnit(softness / 100);
  if (featherAmount <= 0) return 0;

  const totalPixels = selected.length;
  const haloRadius = 1 + Math.round(featherAmount * 5);
  const selectedEdgeDistance = buildSelectedEdgeDistance(selected, sourceData, width, totalPixels, haloRadius, "all");
  const sampleRadius = haloRadius + 2 + Math.round(softnessAmount * 2);
  const targetTolerance = Math.max(1, tolerance);
  const maxHaloAlpha = 4 + featherAmount * (46 + softnessAmount * 18);
  const halo = new Uint8ClampedArray(totalPixels * 4);

  const findForegroundSample = (index: number): { color: Rgb; influence: number } | null => {
    const x = index % width;
    const y = Math.floor(index / width);
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
        const sampleAlpha = sourceData[sampleOffset + 3] ?? 0;
        if (sampleAlpha <= 28) continue;

        const targetDistance = Math.sqrt(colorDistanceSquared(sourceData, sampleOffset, target));
        const matteSeparation = clampUnit((targetDistance - targetTolerance * 0.45) / (targetTolerance * 1.55));
        if (matteSeparation <= 0) continue;

        const distanceWeight = Math.pow(1 - sampleDistance / Math.max(1, sampleRadius + 0.001), 1.6);
        const alphaWeight = Math.pow(sampleAlpha / 255, 1.15);
        const weight = distanceWeight * alphaWeight * Math.pow(matteSeparation, 1.2);
        if (weight <= 0) continue;

        redTotal += (sourceData[sampleOffset] ?? 0) * weight;
        greenTotal += (sourceData[sampleOffset + 1] ?? 0) * weight;
        blueTotal += (sourceData[sampleOffset + 2] ?? 0) * weight;
        weightTotal += weight;
      }
    }

    if (weightTotal <= 0) return null;

    return {
      color: [
        Math.round(redTotal / weightTotal),
        Math.round(greenTotal / weightTotal),
        Math.round(blueTotal / weightTotal),
      ],
      influence: clampUnit(weightTotal / (1.15 + sampleRadius * 0.38)),
    };
  };

  for (let index = 0; index < totalPixels; index += 1) {
    if (!selected[index]) continue;

    const distanceFromCut = selectedEdgeDistance[index] ?? 0;
    if (distanceFromCut === 0) continue;

    const sample = findForegroundSample(index);
    if (!sample) continue;

    const offset = index * 4;
    const sourceAlpha = sourceData[offset + 3] ?? 0;
    if (sourceAlpha <= 0) continue;

    const edgePosition = clampUnit((haloRadius - distanceFromCut + 1) / Math.max(1, haloRadius));
    const edgeCurve = 1.72 - softnessAmount * 0.58 - featherAmount * 0.46;
    const alpha = Math.min(
      sourceAlpha,
      Math.round(maxHaloAlpha * Math.pow(edgePosition, edgeCurve) * (0.55 + sample.influence * 0.45)),
    );
    if (alpha <= 0) continue;

    halo[offset] = sample.color[0];
    halo[offset + 1] = sample.color[1];
    halo[offset + 2] = sample.color[2];
    halo[offset + 3] = alpha;
  }

  const blurPasses = Math.round(softnessAmount * 2 + featherAmount * 2);
  for (let pass = 0; pass < blurPasses; pass += 1) {
    const previous = new Uint8ClampedArray(halo);

    for (let index = 0; index < totalPixels; index += 1) {
      if (!selected[index] || (selectedEdgeDistance[index] ?? 0) === 0) continue;

      const x = index % width;
      const y = Math.floor(index / width);
      const offset = index * 4;
      let redTotal = 0;
      let greenTotal = 0;
      let blueTotal = 0;
      let alphaTotal = 0;
      let weightTotal = 0;

      for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
        const sampleY = y + yOffset;
        if (sampleY < 0 || sampleY >= height) continue;

        for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
          const sampleX = x + xOffset;
          if (sampleX < 0 || sampleX >= width) continue;

          const sampleIndex = sampleY * width + sampleX;
          if (!selected[sampleIndex]) continue;

          const sampleOffset = sampleIndex * 4;
          const sampleDistance = Math.max(1, Math.hypot(xOffset, yOffset));
          const weight = xOffset === 0 && yOffset === 0 ? 1.8 : 1 / sampleDistance;
          const sampleAlpha = previous[sampleOffset + 3] ?? 0;
          weightTotal += weight;

          if (sampleAlpha <= 0) continue;
          redTotal += (previous[sampleOffset] ?? 0) * sampleAlpha * weight;
          greenTotal += (previous[sampleOffset + 1] ?? 0) * sampleAlpha * weight;
          blueTotal += (previous[sampleOffset + 2] ?? 0) * sampleAlpha * weight;
          alphaTotal += sampleAlpha * weight;
        }
      }

      if (alphaTotal <= 0 || weightTotal <= 0) continue;

      halo[offset] = Math.round(redTotal / alphaTotal);
      halo[offset + 1] = Math.round(greenTotal / alphaTotal);
      halo[offset + 2] = Math.round(blueTotal / alphaTotal);
      halo[offset + 3] = Math.round(alphaTotal / weightTotal);
    }
  }

  let changed = 0;
  for (let index = 0; index < totalPixels; index += 1) {
    if (!selected[index]) continue;

    const offset = index * 4;
    const alpha = halo[offset + 3] ?? 0;
    if (alpha <= 0) continue;

    if (
      data[offset] === halo[offset] &&
      data[offset + 1] === halo[offset + 1] &&
      data[offset + 2] === halo[offset + 2] &&
      data[offset + 3] === alpha
    ) {
      continue;
    }

    data[offset] = halo[offset] ?? 0;
    data[offset + 1] = halo[offset + 1] ?? 0;
    data[offset + 2] = halo[offset + 2] ?? 0;
    data[offset + 3] = alpha;
    changed += 1;
  }

  return changed;
}

function softenKeptCutEdge(
  imageData: ImageData,
  selected: Uint8Array,
  sourceData: Uint8ClampedArray,
  target: Rgb,
  tolerance: number,
  softness: number,
  feather: number,
): number {
  const { data, width, height } = imageData;
  const softnessAmount = clampUnit(softness / 100);
  const featherAmount = clampUnit(feather / 100);
  const transitionAmount = clampUnit(softnessAmount * 0.72 + featherAmount * 0.42);
  if (transitionAmount <= 0) return 0;

  const totalPixels = selected.length;
  const edgeRadius = 1 + Math.round(softnessAmount * 2 + featherAmount * 3);
  const { edgeDistance } = buildEdgeBand(selected, width, totalPixels, edgeRadius, "all");
  const softened = new Uint8ClampedArray(data);
  const matteTolerance = Math.max(1, tolerance * (1.14 + transitionAmount * 0.82));

  for (let index = 0; index < totalPixels; index += 1) {
    const distanceFromCut = edgeDistance[index] ?? 0;
    if (distanceFromCut === 0) continue;

    const offset = index * 4;
    const currentAlpha = data[offset + 3] ?? 0;
    const originalAlpha = sourceData[offset + 3] ?? 0;
    if (currentAlpha <= 0 || originalAlpha <= 0) continue;

    const edgePosition = clampUnit((edgeRadius - distanceFromCut + 1) / Math.max(1, edgeRadius));
    const targetDistance = Math.sqrt(colorDistanceSquared(sourceData, offset, target));
    const matteSimilarity = targetDistance <= matteTolerance ? 1 - targetDistance / matteTolerance : 0;
    const alphaVulnerability = clampUnit((248 - originalAlpha) / (218 - transitionAmount * 82));
    const softenStrength =
      transitionAmount *
      Math.pow(edgePosition, 0.92 + (1 - featherAmount) * 0.28) *
      (0.16 + matteSimilarity * 0.58 + alphaVulnerability * 0.3);
    softened[offset + 3] = Math.min(currentAlpha, Math.round(currentAlpha * (1 - clampUnit(softenStrength))));
  }

  const blurred = new Uint8ClampedArray(softened);
  for (let index = 0; index < totalPixels; index += 1) {
    const distanceFromCut = edgeDistance[index] ?? 0;
    if (distanceFromCut === 0) continue;

    const x = index % width;
    const y = Math.floor(index / width);
    const offset = index * 4;
    const currentAlpha = softened[offset + 3] ?? 0;
    if (currentAlpha <= 0) continue;

    let alphaTotal = 0;
    let weightTotal = 0;

    for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
      const sampleY = y + yOffset;
      if (sampleY < 0 || sampleY >= height) continue;

      for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
        const sampleX = x + xOffset;
        if (sampleX < 0 || sampleX >= width) continue;

        const sampleIndex = sampleY * width + sampleX;
        const sampleOffset = sampleIndex * 4;
        const sampleAlpha = selected[sampleIndex] ? 0 : (softened[sampleOffset + 3] ?? 0);
        const sampleDistance = Math.max(1, Math.hypot(xOffset, yOffset));
        const weight = xOffset === 0 && yOffset === 0 ? 1.8 : 1 / sampleDistance;

        alphaTotal += sampleAlpha * weight;
        weightTotal += weight;
      }
    }

    if (weightTotal <= 0) continue;

    const edgePosition = clampUnit((edgeRadius - distanceFromCut + 1) / Math.max(1, edgeRadius));
    const averagedAlpha = Math.round(alphaTotal / weightTotal);
    const blurMix = transitionAmount * Math.pow(edgePosition, 0.72) * 0.64;
    blurred[offset + 3] = Math.min(
      currentAlpha,
      Math.round(currentAlpha * (1 - blurMix) + averagedAlpha * blurMix),
    );
  }

  let changed = 0;
  for (let index = 0; index < totalPixels; index += 1) {
    const distanceFromCut = edgeDistance[index] ?? 0;
    if (distanceFromCut === 0) continue;

    const offset = index * 4;
    const nextAlpha = blurred[offset + 3] ?? 0;
    if (nextAlpha === data[offset + 3]) continue;

    data[offset + 3] = nextAlpha;
    changed += 1;
  }

  return changed;
}

function addSelectedEdgeHalo(
  imageData: ImageData,
  selected: Uint8Array,
  sourceData: Uint8ClampedArray,
  target: Rgb,
  tolerance: number,
  featherStrength: number,
  rimStrength: number,
): number {
  const { data, width, height } = imageData;
  const featherAmount = clampUnit(featherStrength / 100);
  const rimAmount = clampUnit(rimStrength / 100);
  if (featherAmount <= 0 || rimAmount <= 0) return 0;

  const totalPixels = width * height;
  const haloRadius = 1 + Math.round(featherAmount * 3);
  const selectedEdgeDistance = buildSelectedEdgeDistance(selected, sourceData, width, totalPixels, haloRadius, "all");
  const sampleRadius = 3 + Math.round(featherAmount * 4);
  const targetTolerance = Math.max(1, tolerance);
  const maxHaloAlpha = 4 + rimAmount * 62;
  let changed = 0;

  const findHaloNeighborColor = (index: number): Rgb | null => {
    const x = index % width;
    const y = Math.floor(index / width);
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
        const alpha = data[sampleOffset + 3] ?? 0;
        if (alpha <= 36) continue;

        const targetDistance = Math.sqrt(colorDistanceSquared(data, sampleOffset, target));
        const matteSeparation = clampUnit((targetDistance - targetTolerance * 0.45) / (targetTolerance * 1.65));
        if (matteSeparation <= 0) continue;

        const red = data[sampleOffset] ?? 0;
        const green = data[sampleOffset + 1] ?? 0;
        const blue = data[sampleOffset + 2] ?? 0;
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

  for (let index = 0; index < totalPixels; index += 1) {
    if (!selected[index]) continue;

    const distanceFromCut = selectedEdgeDistance[index] ?? 0;
    if (distanceFromCut === 0) continue;

    const foregroundColor = findHaloNeighborColor(index);
    if (!foregroundColor) continue;

    const offset = index * 4;
    const sourceAlpha = sourceData[offset + 3] ?? 0;
    if (sourceAlpha <= 0) continue;

    const edgePosition = clampUnit((haloRadius - distanceFromCut + 1) / Math.max(1, haloRadius));
    const haloAlpha = Math.round(maxHaloAlpha * Math.pow(edgePosition, 1.45));
    if (haloAlpha <= 0) continue;

    const existingAlpha = data[offset + 3] ?? 0;
    const nextAlpha = Math.min(sourceAlpha, Math.max(existingAlpha, haloAlpha));
    const haloMix = existingAlpha > 0 ? clampUnit(haloAlpha / Math.max(1, existingAlpha + haloAlpha)) : 1;
    const nextRed = Math.round((data[offset] ?? 0) * (1 - haloMix) + foregroundColor[0] * haloMix);
    const nextGreen = Math.round((data[offset + 1] ?? 0) * (1 - haloMix) + foregroundColor[1] * haloMix);
    const nextBlue = Math.round((data[offset + 2] ?? 0) * (1 - haloMix) + foregroundColor[2] * haloMix);
    if (
      data[offset] === nextRed &&
      data[offset + 1] === nextGreen &&
      data[offset + 2] === nextBlue &&
      data[offset + 3] === nextAlpha
    ) {
      continue;
    }

    data[offset] = nextRed;
    data[offset + 1] = nextGreen;
    data[offset + 2] = nextBlue;
    data[offset + 3] = nextAlpha;
    changed += 1;
  }

  return changed;
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

export function removeWandSelection(
  imageData: ImageData,
  startX: number,
  startY: number,
  tolerance: number,
  options: WandCleanupOptions,
): WandResult {
  const { data, width, height } = imageData;
  const startIndex = startY * width + startX;
  const [red, green, blue, targetAlpha] = readPixel(imageData, startIndex);
  if (targetAlpha <= 8) return getEmptyWandResult(imageData, startX, startY);

  const target: Rgb = [red, green, blue];
  const totalPixels = width * height;
  const sourceData = new Uint8ClampedArray(data);
  const edgeGuardAmount = clampUnit(options.edgeGuard / 100);
  const localRadius = Math.max(2, Math.round(options.radius));
  const localRadiusSquared = localRadius * localRadius;
  const startLocalX = startX;
  const startLocalY = startY;

  const canSelect = (index: number, toleranceBoost: number): boolean => {
    const offset = index * 4;
    const alpha = sourceData[offset + 3] ?? 0;
    if (alpha <= 8) return false;

    const boostedTolerance = Math.max(1, tolerance * toleranceBoost);
    const targetDistanceSquared = colorDistanceSquared(sourceData, offset, target);
    if (targetDistanceSquared > boostedTolerance * boostedTolerance) return false;
    if (edgeGuardAmount <= 0) return true;

    const targetDistance = Math.sqrt(targetDistanceSquared);
    if (targetDistance <= tolerance * (0.18 + (1 - edgeGuardAmount) * 0.16)) return true;

    const x = index % width;
    const y = Math.floor(index / width);
    let foregroundNeighbors = 0;
    let neighborCount = 0;
    let closestForegroundDistance = Number.POSITIVE_INFINITY;

    for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
      const sampleY = y + yOffset;
      if (sampleY < 0 || sampleY >= height) continue;

      for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
        if (xOffset === 0 && yOffset === 0) continue;

        const sampleX = x + xOffset;
        if (sampleX < 0 || sampleX >= width) continue;

        const sampleIndex = sampleY * width + sampleX;
        const sampleOffset = sampleIndex * 4;
        const sampleAlpha = sourceData[sampleOffset + 3] ?? 0;
        if (sampleAlpha <= 32) continue;

        neighborCount += 1;
        const neighborTargetDistance = Math.sqrt(colorDistanceSquared(sourceData, sampleOffset, target));
        if (neighborTargetDistance <= tolerance * (1.05 - edgeGuardAmount * 0.18)) continue;

        foregroundNeighbors += 1;
        const redDistance = (sourceData[offset] ?? 0) - (sourceData[sampleOffset] ?? 0);
        const greenDistance = (sourceData[offset + 1] ?? 0) - (sourceData[sampleOffset + 1] ?? 0);
        const blueDistance = (sourceData[offset + 2] ?? 0) - (sourceData[sampleOffset + 2] ?? 0);
        closestForegroundDistance = Math.min(
          closestForegroundDistance,
          Math.hypot(redDistance, greenDistance, blueDistance),
        );
      }
    }

    if (foregroundNeighbors === 0 || neighborCount === 0) return true;

    const edgePressure = foregroundNeighbors / neighborCount;
    const weakTargetMatch = targetDistance > tolerance * (0.36 + (1 - edgeGuardAmount) * 0.32);
    const pulledTowardForeground =
      closestForegroundDistance < targetDistance * (1.1 + edgeGuardAmount * 1.15) + edgeGuardAmount * 10;
    const crowdedByForeground = edgePressure > 0.18 + (1 - edgeGuardAmount) * 0.42;

    return !(weakTargetMatch && pulledTowardForeground && crowdedByForeground);
  };

  const selected = new Uint8Array(totalPixels);

  if (options.mode === "connected") {
    const visited = new Uint8Array(totalPixels);
    const stack = new Int32Array(totalPixels);
    let stackLength = 0;

    const pushPixel = (index: number) => {
      if (visited[index]) return;
      visited[index] = 1;
      if (!canSelect(index, 1)) return;
      selected[index] = 1;
      stack[stackLength++] = index;
    };

    pushPixel(startIndex);

    while (stackLength > 0) {
      visitNeighbors(stack[--stackLength], width, totalPixels, "all", pushPixel);
    }
  } else if (options.mode === "local") {
    const minX = Math.max(0, startLocalX - localRadius);
    const maxX = Math.min(width - 1, startLocalX + localRadius);
    const minY = Math.max(0, startLocalY - localRadius);
    const maxY = Math.min(height - 1, startLocalY + localRadius);

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const distanceX = x - startLocalX;
        const distanceY = y - startLocalY;
        if (distanceX * distanceX + distanceY * distanceY > localRadiusSquared) continue;

        const index = y * width + x;
        if (canSelect(index, 1)) selected[index] = 1;
      }
    }
  }

  let selectedCount = 0;
  for (let index = 0; index < totalPixels; index += 1) {
    if (selected[index]) selectedCount += 1;
  }

  if (selectedCount === 0) {
    return { removed: 0, target: [target[0], target[1], target[2], targetAlpha] };
  }

  const expandedSelection = expandSelection(selected, width, totalPixels, options.expand, canSelect);
  const removed = clearSelection(imageData, expandedSelection);
  softenKeptCutEdge(imageData, expandedSelection, sourceData, target, tolerance, options.softness, options.feather);
  addSelectedSoftHalo(imageData, expandedSelection, sourceData, target, tolerance, options.feather, options.softness);

  return {
    removed,
    target: [target[0], target[1], target[2], targetAlpha],
  };
}

export function removeConnectedColorSoftEdge(
  imageData: ImageData,
  startX: number,
  startY: number,
  tolerance: number,
  featherStrength: number,
  rimStrength: number,
  edgeOffset = 0,
): WandResult {
  const { data, width } = imageData;
  const featherAmount = clampUnit(featherStrength / 100);
  const softTolerance = Math.min(160, Math.round(tolerance * (1.04 + featherAmount * 0.18)));
  const selection = selectConnectedRegion(imageData, startX, startY, softTolerance, "all");
  if (!selection) return getEmptyWandResult(imageData, startX, startY);

  const { selected, target, targetAlpha, totalPixels } = selection;
  const sourceData = new Uint8ClampedArray(data);
  const clearSelected = offsetSelection(selected, sourceData, width, totalPixels, edgeOffset);
  const fringeSelected = edgeOffset < 0 ? selected : clearSelected;
  const removed = clearSelection(imageData, clearSelected);
  addSelectedMatteFeather(imageData, fringeSelected, sourceData, featherStrength);
  addSelectedEdgeHalo(imageData, fringeSelected, sourceData, target, tolerance, featherStrength, rimStrength);

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
  rimStrength = 0,
  edgeOffset = 0,
): WandResult {
  const { data, width, height } = imageData;
  const decontaminateAmount = clampUnit(decontaminateStrength / 100);
  const featherAmount = clampUnit(featherStrength / 100);
  const edgeStrength = Math.pow(decontaminateAmount, 0.72);
  const selectionTolerance = Math.min(176, Math.round(tolerance * 1.24));
  const selection = selectConnectedRegion(imageData, startX, startY, selectionTolerance, "all");
  if (!selection) return getEmptyWandResult(imageData, startX, startY);

  const { selected, target, targetAlpha, totalPixels } = selection;
  const clearSelected = offsetSelection(selected, new Uint8ClampedArray(data), width, totalPixels, edgeOffset);
  const fringeSelected = edgeOffset < 0 ? selected : clearSelected;
  const edgeRadius = 1 + Math.round(featherAmount * 7);
  const matteTolerance = Math.min(244, Math.round(tolerance * (1.55 + edgeStrength * 0.7 + featherAmount * 0.25)));
  const foregroundSearchRadius = 3 + edgeRadius + Math.round(edgeStrength * 2);
  const sourceData = new Uint8ClampedArray(data);
  const { edgeDistance, edgeNormalX, edgeNormalY } = buildEdgeBand(clearSelected, width, totalPixels, edgeRadius, "all");
  let removed = clearSelection(imageData, clearSelected);
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
          if (clearSelected[sampleIndex]) continue;

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
    if (clearSelected[index]) continue;

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
      if (clearSelected[index]) continue;

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
          const sampleAlpha = clearSelected[sampleIndex] ? 0 : (smoothedSource[sampleIndex * 4 + 3] ?? 0);
          const weight = xOffset === 0 && yOffset === 0 ? 1.75 : 1 / Math.max(1, sampleDistance);

          if (clearSelected[sampleIndex]) touchesCut = true;
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

  addSelectedMatteFeather(imageData, fringeSelected, sourceData, featherStrength);
  addSelectedEdgeHalo(imageData, fringeSelected, sourceData, target, tolerance, featherStrength, rimStrength);

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
  eraserOpacity: number,
  blurStrength: number,
  targetCleanOptions?: TargetCleanBrushOptions,
): number {
  const { data, width, height } = imageData;
  const restoreSource = originalImage?.data ?? null;
  const blurSource = mode === "blur" ? new Uint8ClampedArray(data) : null;
  const cleanSource = mode === "clean" ? new Uint8ClampedArray(data) : null;
  const eraserHardnessAmount = clampUnit(eraserHardness / 100);
  const eraserOpacityAmount = clampUnit(eraserOpacity / 100);
  const blurAmount = clampUnit(blurStrength / 100);
  const cleanTarget = targetCleanOptions?.target ?? null;
  const cleanTargetRgb: Rgb | null = cleanTarget ? [cleanTarget[0], cleanTarget[1], cleanTarget[2]] : null;
  const cleanTolerance = Math.max(1, targetCleanOptions?.tolerance ?? 1);
  const cleanEdgeGuardAmount = clampUnit((targetCleanOptions?.edgeGuard ?? 0) / 100);
  const cleanFeatherAmount = clampUnit((targetCleanOptions?.feather ?? 0) / 100);
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
      if (mode === "clean") {
        if (!cleanSource || !cleanTarget || !cleanTargetRgb || cleanTarget[3] <= 8) continue;

        const originalAlpha = data[offset + 3] ?? 0;
        if (originalAlpha <= 0) continue;

        const targetDistance = Math.sqrt(colorDistanceSquared(cleanSource, offset, cleanTargetRgb));
        if (targetDistance > cleanTolerance) continue;

        if (cleanEdgeGuardAmount > 0) {
          let neighborCount = 0;
          let foregroundNeighbors = 0;

          for (let sampleY = Math.max(0, y - 1); sampleY <= Math.min(height - 1, y + 1); sampleY += 1) {
            for (let sampleX = Math.max(0, x - 1); sampleX <= Math.min(width - 1, x + 1); sampleX += 1) {
              if (sampleX === x && sampleY === y) continue;

              const sampleOffset = (sampleY * width + sampleX) * 4;
              const sampleAlpha = cleanSource[sampleOffset + 3] ?? 0;
              if (sampleAlpha <= 32) continue;

              neighborCount += 1;
              const neighborTargetDistance = Math.sqrt(colorDistanceSquared(cleanSource, sampleOffset, cleanTargetRgb));
              if (neighborTargetDistance > cleanTolerance * (1.04 - cleanEdgeGuardAmount * 0.18)) {
                foregroundNeighbors += 1;
              }
            }
          }

          const weakTargetMatch = targetDistance > cleanTolerance * (0.22 + (1 - cleanEdgeGuardAmount) * 0.44);
          const crowdedByForeground =
            neighborCount > 0 && foregroundNeighbors / neighborCount > 0.22 + (1 - cleanEdgeGuardAmount) * 0.45;
          if (weakTargetMatch && crowdedByForeground) continue;
        }

        const normalizedDistance = Math.sqrt(dx * dx + dy * dy) / Math.max(1, radius);
        const hardCore = cleanFeatherAmount <= 0.01 ? 1 : 1 - cleanFeatherAmount * 0.84;
        const eraseAmount =
          normalizedDistance <= hardCore
            ? 1
            : Math.pow(clampUnit((1 - normalizedDistance) / Math.max(0.001, 1 - hardCore)), 1.65);
        const nextAlpha = Math.round(originalAlpha * (1 - eraseAmount));
        if (nextAlpha === originalAlpha) continue;

        data[offset + 3] = nextAlpha;
        changed += 1;
        continue;
      }

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
        const nextAlpha = Math.round(originalAlpha * (1 - eraseAmount * eraserOpacityAmount));
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
  eraserOpacity: number,
  blurStrength: number,
  targetCleanOptions?: TargetCleanBrushOptions,
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
      eraserOpacity,
      blurStrength,
      targetCleanOptions,
    );
  }

  return changed;
}
