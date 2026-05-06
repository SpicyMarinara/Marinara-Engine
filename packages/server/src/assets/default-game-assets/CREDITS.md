# Game Assets Credits

All assets in this directory are licensed under **CC0 (Public Domain)** and are free to use for any purpose.

## Music

| File                                                  | Title                       | Author                       | Source                                                                    |
| ----------------------------------------------------- | --------------------------- | ---------------------------- | ------------------------------------------------------------------------- |
| `music/combat/fantasy/intense/battle-epic.mp3`        | Battle Theme A              | cynicmusic (pixelsphere.org) | [OpenGameArt](https://opengameart.org/content/battle-theme-a)             |
| `music/dialogue/slice_of_life/calm/town-peaceful.mp3` | Town Theme RPG              | cynicmusic (pixelsphere.org) | [OpenGameArt](https://opengameart.org/content/town-theme-rpg)             |
| `music/exploration/fantasy/calm/field-of-dreams.mp3`  | The Field Of Dreams         | pauliuw                      | [OpenGameArt](https://opengameart.org/content/the-field-of-dreams)        |
| `music/exploration/horror/tense/dark-forest.mp3`      | Dark Forest Theme           | cynicmusic (pixelsphere.org) | [OpenGameArt](https://opengameart.org/content/dark-forest-theme)          |
| `music/travel_rest/fantasy/calm/old-tower-inn.mp3`    | Medieval: The Old Tower Inn | RandomMind                   | [OpenGameArt](https://opengameart.org/content/medieval-the-old-tower-inn) |

## Sound Effects

| Directory                                                          | Pack                 | Author             | Source                                                              |
| ------------------------------------------------------------------ | -------------------- | ------------------ | ------------------------------------------------------------------- |
| `sfx/ui/`, `sfx/exploration/` (partial)                            | 50 RPG Sound Effects | Kenney (kenney.nl) | [OpenGameArt](https://opengameart.org/content/50-rpg-sound-effects) |
| `sfx/combat/`, `sfx/ui/` (partial), `sfx/exploration/` (partial)   | RPG Sound Pack       | artisticdude       | [OpenGameArt](https://opengameart.org/content/rpg-sound-pack)       |
| `sfx/exploration/bed-creak.wav`, `sfx/exploration/wet-squelch.wav` | Procedural SFX       | Marinara Engine    | Generated procedurally, CC0                                         |

## Ambient Sounds

Curated ambient tracks for environmental atmosphere. All sourced from free/CC0
sound libraries (OpenGameArt, Freesound.org CC0 tier, Kenney, etc.).

| File                                    | Category |
| --------------------------------------- | -------- |
| `ambient/nature/autumn-wind-leaves.mp3` | nature   |
| `ambient/nature/birds-singing.ogg`      | nature   |
| `ambient/nature/crickets-night.mp3`     | nature   |
| `ambient/nature/howling-wind.ogg`       | nature   |
| `ambient/nature/rain-thunder.ogg`       | nature   |
| `ambient/nature/river-flowing.ogg`      | nature   |
| `ambient/nature/swamp-insects.ogg`      | nature   |
| `ambient/nature/water-stream.mp3`       | nature   |
| `ambient/urban/crowd-commotion.ogg`     | urban    |
| `ambient/urban/crowd-murmur.mp3`        | urban    |
| `ambient/interior/dungeon-cave.ogg`     | interior |
| `ambient/interior/eerie-atmosphere.ogg` | interior |
| `ambient/interior/rain-on-roof.mp3`     | interior |

## Character Sprites

| Directory                                      | Pack                                                               | Author       | Source                                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------ | ------------ | ---------------------------------------------------------------------------- |
| `sprites/generic-fantasy/cabbit-vn/`           | VN Characters (17 sprites, 5 characters with emotions)             | Cabbit KusSv | [OpenGameArt](https://opengameart.org/content/vn-characters)                 |
| `sprites/generic-fantasy/anime-vn/`            | VN Character Sprite (65 sprites, 5 anime characters with emotions) | FALLiNG_AiR  | [OpenGameArt](https://opengameart.org/content/visual-novel-character-sprite) |
| `sprites/generic-fantasy/rpg-portraits/`       | 2D RPG Character Portraits (33 portraits + silhouettes)            | Arcade Dream | [OpenGameArt](https://opengameart.org/content/2d-rpg-character-portraits)    |
| `sprites/generic-fantasy/hachi-characters.png` | Character Imageset (sprite sheet)                                  | HachiStudio  | [OpenGameArt](https://opengameart.org/content/character-imageset)            |

## Adding Your Own Assets

Drop files into the appropriate subdirectory and hit the **Rescan** button in the app, or call `POST /api/game-assets/rescan`.

Music must use `music/<state>/<genre>/<intensity>/<filename>`, for example:

- `music/exploration/fantasy/calm/forest-dawn.mp3`
- `music/dialogue/romance/tense/confession.mp3`
- `music/combat/horror/intense/boss-theme.mp3`

Supported states: `exploration`, `dialogue`, `combat`, `travel_rest`.
Supported genres: `fantasy`, `horror`, `romance`, `mystery`, `scifi`, `modern`, `slice_of_life`, `adventure`, `drama`, `custom`.
Supported intensities: `calm`, `tense`, `intense`.

Supported formats:

- **Music/SFX**: `.mp3`, `.ogg`, `.wav`, `.flac`, `.m4a`
- **Backgrounds**: `.jpg`, `.jpeg`, `.png`, `.webp`
- **Sprites**: `.png`, `.webp`, `.svg`
