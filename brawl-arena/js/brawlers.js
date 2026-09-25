"use strict";
// The roster. Numbers follow Brawl Stars conventions: health and damage in the
// thousands/hundreds, 3 ammo that reload over time, ranges and speeds in tiles
// (normal walking speed is 2.4 tiles per second).
//
// aim / superAim describe the aiming indicator and how the attack is targeted:
//   cone  (range, spread)   line (range)   lob (range, radius: lands at the aimed spot)
//   leap  (range, radius: the brawler jumps to the aimed spot)

const BRAWLERS = {
  buck: {
    name: "Buck",
    role: "Shotgun",
    desc: "Fires 5 shells in a spread. Every shell that lands hurts, so get close.",
    superDesc: "Super: Big Bang. A wide blast that knocks enemies back and smashes walls.",
    color: "#f08a3a", dark: "#8a4515", skin: "#f5c89a",
    hp: 4200, speed: 2.55, reload: 1.5, superCost: 3000, prefRange: 3.2,
    bars: { hp: 0.7, dmg: 0.85, range: 0.55, speed: 0.5 },
    aim: { type: "cone", range: 7.2, spread: 0.52 },
    superAim: { type: "cone", range: 7.8, spread: 0.8 },
    shotSpeed: 15,
    attack(G, b, ang) {
      for (let i = 0; i < 5; i++) {
        spawnShot(G, b, ang + (i - 2) * 0.13 + rand(-0.02, 0.02),
          { speed: 15 * rand(0.94, 1.06), range: 7.2, dmg: 360, r: 0.13, color: "#ffd27a" });
      }
      sfx(G, "shotgun", b);
    },
    superAttack(G, b, ang) {
      for (let i = 0; i < 9; i++) {
        spawnShot(G, b, ang + (i - 4) * 0.1,
          { speed: 15, range: 7.8, dmg: 360, r: 0.16, color: "#ffb13b", knock: 2.2, breakWalls: true, isSuper: true });
      }
      sfx(G, "boom", b, 0.7);
    },
  },

  pike: {
    name: "Pike",
    role: "Sharpshooter",
    desc: "Fires 6 quick bullets in a straight line. Long range, low health.",
    superDesc: "Super: Bullet Storm. 12 long-range bullets that punch through walls.",
    color: "#3d7be0", dark: "#1b3d78", skin: "#f1c393",
    hp: 2800, speed: 2.4, reload: 1.8, superCost: 3200, prefRange: 7,
    bars: { hp: 0.45, dmg: 0.7, range: 0.9, speed: 0.5 },
    aim: { type: "line", range: 8.7 },
    superAim: { type: "line", range: 11 },
    shotSpeed: 20,
    attack(G, b, ang) {
      b.burst = { n: 6, gap: 0.075, t: 0, ang, fire(G, b, a) {
        spawnShot(G, b, a + rand(-0.025, 0.025), { speed: 20, range: 8.7, dmg: 280, r: 0.11, color: "#bfe3ff" });
        sfx(G, "pistol", b, 0.6);
      } };
    },
    superAttack(G, b, ang) {
      b.burst = { n: 12, gap: 0.05, t: 0, ang, fire(G, b, a) {
        spawnShot(G, b, a + rand(-0.03, 0.03), { speed: 21, range: 11, dmg: 320, r: 0.13, color: "#7fd0ff", breakWalls: true, isSuper: true });
        sfx(G, "pistol", b, 0.8);
      } };
    },
  },

  tink: {
    name: "Tink",
    role: "Bomb thrower",
    desc: "Lobs bombs over walls. They explode where they land and hit everyone nearby.",
    superDesc: "Super: Big Barrel. A huge bomb that blows up walls and knocks enemies flying.",
    color: "#58b848", dark: "#2c6a22", skin: "#f3c79c",
    hp: 2800, speed: 2.4, reload: 1.9, superCost: 2500, prefRange: 5.8,
    bars: { hp: 0.45, dmg: 0.8, range: 0.75, speed: 0.5 },
    aim: { type: "lob", range: 7.5, radius: 1.1, minRange: 1.2 },
    superAim: { type: "lob", range: 7.5, radius: 2.3, minRange: 1.2 },
    lobTime: 0.7,
    attack(G, b, ang, dist) {
      lobBomb(G, b, ang, clamp(dist, 1.2, 7.5), { T: 0.7, radius: 1.1, dmg: 900, color: "#2b2b2b" });
      sfx(G, "throw", b);
    },
    superAttack(G, b, ang, dist) {
      lobBomb(G, b, ang, clamp(dist, 1.2, 7.5), { T: 0.75, radius: 2.3, dmg: 2000, knock: 2.6, breakWalls: true, big: true, color: "#9a5b2a" });
      sfx(G, "throw", b);
    },
  },

  rook: {
    name: "Rook",
    role: "Tank",
    desc: "Huge health and a flurry of 4 short-range punches. Walk through the bushes and brawl.",
    superDesc: "Super: Meteor Leap. Jump over anything and crash down on enemies, smashing walls.",
    color: "#8b55d6", dark: "#43246f", skin: "#e0a67a",
    hp: 6600, speed: 2.85, reload: 1.15, superCost: 3500, prefRange: 1.2,
    bars: { hp: 1, dmg: 0.75, range: 0.2, speed: 0.75 },
    aim: { type: "line", range: 3.2, width: 0.9 },
    superAim: { type: "leap", range: 7, radius: 1.6, minRange: 1 },
    shotSpeed: 16,
    attack(G, b, ang) {
      b.burst = { n: 4, gap: 0.08, t: 0, ang, i: 0, fire(G, b, a) {
        const side = (this.i++ % 2 ? 1 : -1) * 0.18;
        spawnShot(G, b, a, { speed: 16, range: 3.2, dmg: 420, r: 0.24, color: "#ffe1c2", offset: side, fist: true });
        sfx(G, "punch", b, 0.7);
      } };
    },
    superAttack(G, b, ang, dist) {
      const d = clamp(dist, 1, 7);
      b.leap = { x0: b.x, y0: b.y, x1: b.x + Math.cos(ang) * d, y1: b.y + Math.sin(ang) * d, t: 0, T: 0.35 + d * 0.06 };
      sfx(G, "jump", b);
    },
  },
};

const BOT_NAMES = ["Ace", "Blaze", "Comet", "Dot", "Echo", "Fizz", "Gus", "Hex", "Ivy", "Jinx", "Kip", "Lux",
  "Mo", "Nix", "Ozzy", "Pip", "Quin", "Rue", "Sid", "Taz", "Uma", "Vee", "Wren", "Zed"];
