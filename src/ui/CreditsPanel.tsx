import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useGame } from "../store";

type CreditEntry = {
  name: string;
  creator?: string;
  license?: string;
  url?: string;
};

type CreditSection = {
  // Stable id used as a React key and to resolve the translated section
  // heading via t(`credits.section.${id}`). The entry rows below are
  // factual asset/library attribution (creator + license + URL, proper
  // nouns) and stay verbatim across locales.
  id: string;
  entries: CreditEntry[];
};

// Attribution sources, in order of certainty:
//  1. In-repo comments call out Kenney/Quaternius packs by name in biomes.ts,
//     easterEggs.ts, BiomeCosmetics.tsx, Rocks.tsx, HiveDrones.tsx.
//  2. Embedded glTF metadata in each .glb (mesh names, material names,
//     texture filenames) was inspected against the gamedev sister repo
//     (~/projects/gamedev) to confirm pack provenance — Quaternius palette
//     naming, Kenney `Mesh ` prefix + `colormap` Hexagon-Kit naming, the
//     shared `Atlas_Pirate.png` texture (Quaternius Pirate Kit), the
//     `Bark_DeadTree*.png` / `Bush_Common*` mesh names (Synty Stylized
//     Nature MegaKit), and the palette-only Tent/Torch (Quaternius
//     Survival Kit).
//  3. Audio matched by md5 against the gamedev sister repo's sounds
//     directory — Kevin MacLeod tracks via ID3 + filename, biome.mp3
//     files via md5, every SFX via md5 against /assets/sounds.
const SECTIONS: CreditSection[] = [
  {
    id: "models3d",
    entries: [
      {
        name: "Sci-fi props — machines, satellite dishes, hangars, rocket bases, rover, barrels, crystals, structures, meteor (scifi/*)",
        creator: "Kenney",
        license: "CC0 1.0",
        url: "https://kenney.nl/assets/space-kit",
      },
      {
        name: "Space Base Bits — modular outpost colonies: habitat domes, drills, landing pads, landers, solar panels, cargo, rovers (outpost/*)",
        creator: "Kay Lousberg",
        license: "CC0 1.0",
        url: "https://kaylousberg.itch.io/space-base-bits",
      },
      {
        name: "Ultimate Space Kit — outpost structures: geodesic dome, hab buildings, storage domes, crates, rocks (spacekit/*)",
        creator: "Quaternius",
        license: "CC0 1.0",
        url: "https://quaternius.com/packs/ultimatespacekit.html",
      },
      {
        name: "Hexagon-kit landmarks — Crystal1 (snow), Crystal1 (wasteland)",
        creator: "Kenney",
        license: "CC0 1.0",
        url: "https://kenney.nl/assets/hexagon-kit",
      },
      {
        name: "Medieval Village house — snow biome cabin (House_1)",
        creator: "Quaternius",
        license: "CC0 1.0",
        url: "https://quaternius.com/packs/medievalvillagepack.html",
      },
      {
        name: "Alien biome vegetation (biomes/alien/Tree_*, Bush_*, Plant_*)",
        creator: "Quaternius",
        license: "CC0 1.0",
        url: "https://quaternius.com/packs/ultimatespacekit.html",
      },
      {
        name: "Crystal Pack — blue crystal formations (biomes/alien/Crystal_*)",
        creator: "Quaternius",
        license: "CC0 1.0",
        url: "https://quaternius.com/packs/crystalpack.html",
      },
      {
        name: "Stylized nature props — Bush, Grass, Rock, Tree (nature/*)",
        creator: "Quaternius",
        license: "CC0 1.0",
        url: "https://quaternius.com/packs/stylizednaturemegakit.html",
      },
      {
        name: "Biome rocks, bushes, and trees (biomes/desert, biomes/snow, biomes/wasteland)",
        creator: "Quaternius",
        license: "CC0 1.0",
        url: "https://quaternius.com/packs/stylizednaturemegakit.html",
      },
      {
        name: "Animated dinosaur enemies — Apatosaurus, Parasaurolophus, Stegosaurus, Trex, Triceratops, Velociraptor",
        creator: "Quaternius",
        license: "CC0 1.0",
        url: "https://quaternius.com/packs/animateddinosaurs.html",
      },
      {
        name: "Modular turret meshes — EMP, Flamethrower, Gatling, Gun Cannon, Hive, Lightning, Missile, Plasma, Rail Gun, Shield + root-level tower_*/turret_* variants",
        creator: "Quaternius",
        license: "CC0 1.0",
        url: "https://quaternius.com/packs/moduladefensekit.html",
      },
      {
        name: "Pirate Kit landmarks — Barrel, House, Sawmill (forest); Chest, Skull (desert); Skull, Ruins (wasteland). Atlas_Pirate.png texture, Environment_*/Prop_* mesh naming.",
        creator: "Quaternius",
        license: "CC0 1.0",
        url: "https://quaternius.com/packs/piratekit.html",
      },
      {
        name: "Forest detail props — BushFlowers (Bush_Common_Flowers), Mushroom (Mushroom_Common). Synty POLYGON Nature mesh + texture naming.",
        creator: "Synty Studios",
        license: "Synty Standard",
        url: "https://syntystudios.com/product/polygon-nature-pack/",
      },
      {
        name: "Dead trees — landmarks/desert/DeadTree, landmarks/wasteland/DeadTree (DeadTree_5 mesh, Bark_DeadTree_Normal.png).",
        creator: "Synty Studios",
        license: "Synty Standard",
        url: "https://syntystudios.com/product/polygon-nature-pack/",
      },
      {
        name: "Camp props — Tent (desert + snow), Torch (snow). Palette-only materials, mesh names Tent/Torch.",
        creator: "Quaternius",
        license: "CC0 1.0",
        url: "https://quaternius.com/packs/survivalkit.html",
      },
    ],
  },
  {
    id: "sprites2d",
    entries: [
      {
        name: "Smoke billboard texture for explosion puffs (textures/fx/whitepuff15.png)",
        creator: "Kenney",
        license: "CC0 1.0",
        url: "https://kenney.nl/assets/smoke-particles",
      },
    ],
  },
  {
    id: "audio",
    entries: [
      {
        name: "Magic Forest (audio/music/forest.mp3)",
        creator: "Kevin MacLeod",
        license: "CC BY 4.0",
        url: "https://incompetech.com/music/royalty-free/music.html",
      },
      {
        name: "Black Vortex (audio/music/lava.mp3)",
        creator: "Kevin MacLeod",
        license: "CC BY 4.0",
        url: "https://incompetech.com/music/royalty-free/music.html",
      },
      {
        name: "Bittersweet (audio/music/snow.mp3)",
        creator: "Kevin MacLeod",
        license: "CC BY 4.0",
        url: "https://incompetech.com/music/royalty-free/music.html",
      },
      {
        name: "Corruption (audio/music/wasteland.mp3)",
        creator: "Kevin MacLeod",
        license: "CC BY 4.0",
        url: "https://incompetech.com/music/royalty-free/music.html",
      },
      {
        name: "A Space Journey Through the Solar System (audio/music/alien.mp3)",
        creator: "Pixabay",
        license: "Pixabay Content License",
        url: "https://pixabay.com/music/main-title-a-space-journey-through-the-solar-system-153272/",
      },
      {
        name: "Dunes (audio/music/desert.mp3)",
        creator: "Pixabay",
        license: "Pixabay Content License",
        url: "https://pixabay.com/music/ambient-dunes-7115/",
      },
      {
        name: "Background space ambience (audio/music-ambient.mp3)",
        creator: "FragmentWav",
        license: "Pixabay Content License",
        url: "https://pixabay.com/music/ambient-space-ambient-music-fragmentwav-66481/",
      },

      // SFX cross-referenced by md5 against ~/projects/gamedev/assets/sounds.
      // Filenames there encode source: leading numeric id + username =
      // Freesound (per-sound license at freesound.org/s/{id}/); trailing
      // numeric id = Pixabay (Pixabay Content License). Per-sound rows
      // keep credit accurate without bundling everything into one line.
      {
        name: "Flamethrower (audio/shoot-flame.mp3)",
        creator: "Alexander Jauk",
        license: "Pixabay Content License",
        url: "https://pixabay.com/sound-effects/flamethrower-sound-effect-421402/",
      },
      {
        name: "Pistol gun shot (audio/shoot-pulse.mp3)",
        creator: "Pixabay",
        license: "Pixabay Content License",
        url: "https://pixabay.com/sound-effects/pistol-gun-shot-278821/",
      },
      {
        name: "Cannon explosion (audio/shoot-mortar.mp3)",
        creator: "samsterbirdies",
        license: "Freesound (see source)",
        url: "https://freesound.org/s/621000/",
      },
      {
        name: "Ice magic arrow (audio/shoot-cryo.mp3)",
        creator: "lotteria001",
        license: "Freesound (see source)",
        url: "https://freesound.org/s/709888/",
      },
      {
        name: "Laser cannon (audio/shoot-chain.mp3)",
        creator: "SilverIllusionist",
        license: "Freesound (see source)",
        url: "https://freesound.org/s/670135/",
      },
      {
        name: "Explosion debris (audio/impact.mp3)",
        creator: "NOX_sound",
        license: "Freesound (see source)",
        url: "https://freesound.org/s/560510/",
      },
      {
        name: "Cinematic dun (audio/new-enemy.mp3)",
        creator: "Pixabay",
        license: "Pixabay Content License",
        url: "https://pixabay.com/sound-effects/dun-283044/",
      },
      {
        name: "Biodynamic braam (audio/wave-start.mp3)",
        creator: "Pixabay",
        license: "Pixabay Content License",
        url: "https://pixabay.com/sound-effects/biodynamic-impact-braam-tonal-dark-184276/",
      },
      {
        name: "Coins purchase (audio/wave-call.mp3)",
        creator: "rhodesmas",
        license: "Freesound (see source)",
        url: "https://freesound.org/s/342751/",
      },
      {
        name: "Win sting (audio/wave-clear.mp3)",
        creator: "rhodesmas",
        license: "Freesound (see source)",
        url: "https://freesound.org/s/320672/",
      },
      {
        name: "Level complete (audio/victory.mp3)",
        creator: "Pixabay",
        license: "Pixabay Content License",
        url: "https://pixabay.com/sound-effects/game-level-complete-143022/",
      },
      {
        name: "Marimba lose (audio/defeat.mp3)",
        creator: "Universfield",
        license: "Pixabay Content License",
        url: "https://pixabay.com/sound-effects/marimba-lose-250960/",
      },
      {
        name: "Brass fail (audio/game-over.mp3)",
        creator: "Pixabay",
        license: "Pixabay Content License",
        url: "https://pixabay.com/sound-effects/brass-fail-11-c-207139/",
      },
      {
        name: "Damage hit (audio/life-lost.mp3)",
        creator: "Ash_Rez",
        license: "Freesound (see source)",
        url: "https://freesound.org/s/518887/",
      },
      {
        name: "Level up (audio/upgrade.mp3)",
        creator: "rhodesmas",
        license: "Freesound (see source)",
        url: "https://freesound.org/s/320654/",
      },
      {
        name: "RPG powerup (audio/tower-place.mp3)",
        creator: "ColorsCrimsonTears",
        license: "Freesound (see source)",
        url: "https://freesound.org/s/577965/",
      },
      {
        name: "Mystic UI selection (audio/tower-select.mp3)",
        creator: "HarrisonLace",
        license: "Freesound (see source)",
        url: "https://freesound.org/s/789464/",
      },
      {
        name: "Coin C (audio/tower-sell.mp3)",
        creator: "cabled_mess",
        license: "Freesound (see source)",
        url: "https://freesound.org/s/350874/",
      },
      {
        name: "Connected ping (audio/level-select.mp3)",
        creator: "rhodesmas",
        license: "Freesound (see source)",
        url: "https://freesound.org/s/322897/",
      },
      {
        name: "Casual click pop (audio/ui-click.mp3)",
        creator: "Pixabay",
        license: "Pixabay Content License",
        url: "https://pixabay.com/sound-effects/casual-click-pop-ui-2-262119/",
      },
      {
        name: "Whoosh (audio/ui-open.mp3)",
        creator: "Velcronator",
        license: "Freesound (see source)",
        url: "https://freesound.org/s/733890/",
      },
      {
        name: "Whoosh (audio/ui-close.mp3)",
        creator: "Pixabay",
        license: "Pixabay Content License",
        url: "https://pixabay.com/sound-effects/complex-movements-whoosh-4-239356/",
      },
      {
        name: "Arcade UI (audio/ui-tab.mp3)",
        creator: "Pixabay",
        license: "Pixabay Content License",
        url: "https://pixabay.com/sound-effects/arcade-ui-15-229513/",
      },
      {
        name: "Magical twinkle (audio/star.mp3)",
        creator: "Universfield",
        license: "Pixabay Content License",
        url: "https://pixabay.com/sound-effects/magical-twinkle-242245/",
      },
    ],
  },
  {
    id: "fonts",
    entries: [
      {
        name: "Rajdhani (display font)",
        creator: "Indian Type Foundry",
        license: "SIL Open Font License 1.1",
        url: "https://fonts.google.com/specimen/Rajdhani",
      },
    ],
  },
  {
    id: "icons",
    entries: [
      // public/icon-source.html renders public/models/tower_pulse.glb to
      // generate icon.png + the 32×32 / 128×128 favicons. The icon credit
      // therefore inherits whatever the tower mesh is licensed under
      // (Quaternius Modular Defense Kit, listed above).
      {
        name: "App icons — public/icons/* (rendered from tower_pulse.glb via public/icon-source.html)",
        creator: "Quaternius (mesh)",
        license: "CC0 1.0",
        url: "https://quaternius.com/packs/moduladefensekit.html",
      },
    ],
  },
  {
    id: "libraries",
    entries: [
      {
        name: "React, React DOM",
        creator: "Meta",
        license: "MIT",
        url: "https://react.dev",
      },
      {
        name: "three.js",
        creator: "three.js authors",
        license: "MIT",
        url: "https://threejs.org",
      },
      {
        name: "@react-three/fiber",
        creator: "Poimandres",
        license: "MIT",
        url: "https://github.com/pmndrs/react-three-fiber",
      },
      {
        name: "@react-three/drei",
        creator: "Poimandres",
        license: "MIT",
        url: "https://github.com/pmndrs/drei",
      },
      {
        name: "@react-three/postprocessing",
        creator: "Poimandres",
        license: "MIT",
        url: "https://github.com/pmndrs/react-postprocessing",
      },
      {
        name: "postprocessing",
        creator: "Raoul van Rüschen",
        license: "Zlib",
        url: "https://github.com/pmndrs/postprocessing",
      },
      {
        name: "three-stdlib",
        creator: "Poimandres",
        license: "MIT",
        url: "https://github.com/pmndrs/three-stdlib",
      },
      {
        name: "zustand",
        creator: "Poimandres",
        license: "MIT",
        url: "https://github.com/pmndrs/zustand",
      },
      {
        name: "nanoid",
        creator: "Andrey Sitnik",
        license: "MIT",
        url: "https://github.com/ai/nanoid",
      },
      {
        name: "Tailwind CSS",
        creator: "Tailwind Labs",
        license: "MIT",
        url: "https://tailwindcss.com",
      },
      {
        name: "Vite",
        creator: "Vite contributors",
        license: "MIT",
        url: "https://vitejs.dev",
      },
      {
        name: "@vitejs/plugin-react",
        creator: "Vite contributors",
        license: "MIT",
        url: "https://github.com/vitejs/vite-plugin-react",
      },
      {
        name: "TypeScript",
        creator: "Microsoft",
        license: "Apache-2.0",
        url: "https://www.typescriptlang.org",
      },
      {
        name: "Biome",
        creator: "Biome contributors",
        license: "MIT / Apache-2.0",
        url: "https://biomejs.dev",
      },
      {
        name: "Tauri",
        creator: "Tauri contributors",
        license: "MIT / Apache-2.0",
        url: "https://tauri.app",
      },
      {
        name: "Husky",
        creator: "Typicode",
        license: "MIT",
        url: "https://github.com/typicode/husky",
      },
      {
        name: "lint-staged",
        creator: "Andrey Okonetchnikov",
        license: "MIT",
        url: "https://github.com/lint-staged/lint-staged",
      },
    ],
  },
];

export const CreditsPanel = () => {
  const { t } = useTranslation();
  const setCreditsOpen = useGame((s) => s.setCreditsOpen);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setCreditsOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [setCreditsOpen]);

  return (
    <div className="overlay achievements-overlay">
      <div className="achievements-card">
        <header className="achievements-header">
          <div>
            <h1>{t("credits.title")}</h1>
            <div className="achievements-subtitle">{t("credits.subtitle")}</div>
          </div>
          <button
            type="button"
            className="btn-close"
            onClick={() => setCreditsOpen(false)}
            aria-label={t("credits.close")}
            title={t("credits.close")}
          >
            ×
          </button>
        </header>

        <div className="credits-body">
          <section className="credits-section credits-about">
            <h2 className="credits-section-title">{t("credits.studioName")}</h2>
            <p className="credits-about-text">
              {t("credits.aboutBody")}{" "}
              <a
                className="credits-url"
                href="https://ricoslabs.com"
                target="_blank"
                rel="noopener noreferrer"
              >
                ricoslabs.com
              </a>{" "}
              {t("credits.aboutCatalogue")}
            </p>
          </section>
          {SECTIONS.map((section) => (
            <section key={section.id} className="credits-section">
              <h2 className="credits-section-title">{t(`credits.section.${section.id}`)}</h2>
              <ul className="credits-list">
                {section.entries.map((entry) => (
                  <li key={`${section.id}-${entry.name}`} className="credits-row">
                    <div className="credits-row-name">{entry.name}</div>
                    <div className="credits-row-meta">
                      {entry.creator && <span className="credits-creator">{entry.creator}</span>}
                      {entry.license && <span className="credits-license">{entry.license}</span>}
                      {entry.url && (
                        <a
                          className="credits-url"
                          href={entry.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {t("credits.source")}
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
};
