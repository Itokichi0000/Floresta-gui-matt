// The forest girl (original character for this project) and bitty.
//
// She is inline SVG so her expression can be swapped by parts: only the
// elements whose class matches the current mood (mp-<mood>) are shown.
// Moods: determined (syncing), happy (caught up), worried (stuck),
// sleeping (node unreachable). Animation (breathing, blinking) is CSS and
// stops under prefers-reduced-motion.

const INK = "#24442F";
const SKIN = "#FFE7D6";
const HAIR = "#2E8A4B";
const HAIR_LIGHT = "#4DAA66";
const HOODIE = "#5CBF6A";
const HOODIE_DARK = "#3F9C50";
const LEAF = "#8BDB6E";
const PINK = "#FFD1DC";
const BLUSH = "#FFB0C4";
const GOLD = "#FFD66B";

const GIRL_SVG = `
<svg class="girl" viewBox="0 0 200 250" xmlns="http://www.w3.org/2000/svg" role="img" data-mood="determined">
  <title>Forest girl</title>
  <g class="breathe">
    <!-- hood behind the head -->
    <path d="M30 118 Q26 46 100 40 Q174 46 170 118 Q170 150 150 164 L50 164 Q30 150 30 118 Z"
          fill="${HOODIE_DARK}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    <!-- back hair (bob) -->
    <path d="M44 104 Q40 46 100 40 Q160 46 156 104 L160 150 Q146 160 134 150 L66 150 Q54 160 40 150 Z"
          fill="${HAIR}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>

    <!-- body: green hoodie -->
    <path d="M50 250 L56 186 Q60 156 100 154 Q140 156 144 186 L150 250 Z"
          fill="${HOODIE}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M72 220 Q100 212 128 220 L130 250 L70 250 Z" fill="${HOODIE_DARK}" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M66 164 Q100 188 134 164" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
    <path d="M89 174 L87 200" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M111 174 L113 200" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="87" cy="203" r="4" fill="${GOLD}" stroke="${INK}" stroke-width="2"/>
    <circle cx="113" cy="203" r="4" fill="${GOLD}" stroke="${INK}" stroke-width="2"/>
    <!-- leaf badge on the hoodie -->
    <path d="M124 196 Q136 186 140 198 Q130 206 124 196 Z" fill="${LEAF}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>

    <!-- arms -->
    <g class="mp mp-happy mp-worried mp-sleeping">
      <path d="M58 188 Q42 210 46 234 Q54 240 62 234 Q62 214 70 200 Z" fill="${HOODIE}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
      <circle cx="53" cy="238" r="8" fill="${SKIN}" stroke="${INK}" stroke-width="2.5"/>
    </g>
    <g class="mp mp-determined">
      <!-- raised fist: "let's go!" -->
      <path d="M60 190 Q40 182 34 158 Q42 150 50 156 Q54 172 70 178 Z" fill="${HOODIE}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
      <circle cx="40" cy="150" r="9" fill="${SKIN}" stroke="${INK}" stroke-width="2.5"/>
      <path d="M36 147 L44 147 M36 152 L44 152" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/>
    </g>
    <path d="M142 188 Q158 210 154 234 Q146 240 138 234 Q138 214 130 200 Z" fill="${HOODIE}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    <circle cx="147" cy="238" r="8" fill="${SKIN}" stroke="${INK}" stroke-width="2.5"/>

    <!-- neck and face -->
    <rect x="91" y="140" width="18" height="18" rx="6" fill="${SKIN}" stroke="${INK}" stroke-width="2.5"/>
    <g class="head">
      <ellipse cx="100" cy="100" rx="52" ry="48" fill="${SKIN}" stroke="${INK}" stroke-width="3"/>

      <!-- blush -->
      <ellipse cx="70" cy="119" rx="9" ry="5" fill="${BLUSH}"/>
      <ellipse cx="130" cy="119" rx="9" ry="5" fill="${BLUSH}"/>

      <!-- eyes: open (determined, worried) -->
      <g class="mp mp-determined mp-worried">
        <g class="eyes-open">
          <ellipse cx="80" cy="106" rx="9" ry="12" fill="${INK}"/>
          <ellipse cx="120" cy="106" rx="9" ry="12" fill="${INK}"/>
          <ellipse cx="80" cy="111" rx="6" ry="6" fill="#3FA651"/>
          <ellipse cx="120" cy="111" rx="6" ry="6" fill="#3FA651"/>
          <circle cx="77" cy="101" r="3.6" fill="#FFFFFF"/>
          <circle cx="117" cy="101" r="3.6" fill="#FFFFFF"/>
          <circle cx="83" cy="113" r="1.6" fill="#FFFFFF"/>
          <circle cx="123" cy="113" r="1.6" fill="#FFFFFF"/>
          <path d="M68 96 Q80 88 92 96" fill="none" stroke="${INK}" stroke-width="3.2" stroke-linecap="round"/>
          <path d="M108 96 Q120 88 132 96" fill="none" stroke="${INK}" stroke-width="3.2" stroke-linecap="round"/>
        </g>
      </g>
      <!-- eyes: happy ^ ^ -->
      <g class="mp mp-happy" fill="none" stroke="${INK}" stroke-width="3.6" stroke-linecap="round">
        <path d="M70 109 Q80 96 90 109"/>
        <path d="M110 109 Q120 96 130 109"/>
      </g>
      <!-- eyes: sleeping -->
      <g class="mp mp-sleeping" fill="none" stroke="${INK}" stroke-width="3.4" stroke-linecap="round">
        <path d="M70 106 Q80 114 90 106"/>
        <path d="M110 106 Q120 114 130 106"/>
      </g>

      <!-- brows -->
      <g fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round">
        <path class="mp mp-determined" d="M70 84 L89 89"/>
        <path class="mp mp-determined" d="M130 84 L111 89"/>
        <path class="mp mp-worried" d="M70 89 L89 83"/>
        <path class="mp mp-worried" d="M130 89 L111 83"/>
        <path class="mp mp-happy mp-sleeping" d="M71 87 Q80 82 89 86"/>
        <path class="mp mp-happy mp-sleeping" d="M129 87 Q120 82 111 86"/>
      </g>

      <!-- mouths -->
      <path class="mp mp-determined" d="M91 123 Q100 133 109 123 Q100 126 91 123 Z" fill="#D8546F" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
      <path class="mp mp-happy" d="M87 120 Q100 140 113 120 Q100 124 87 120 Z" fill="#D8546F" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
      <path class="mp mp-worried" d="M91 128 Q95.5 123 100 128 Q104.5 133 109 128" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>
      <ellipse class="mp mp-sleeping" cx="100" cy="126" rx="3.4" ry="2.8" fill="#D8546F" stroke="${INK}" stroke-width="2"/>
    </g>

    <!-- front hair: bangs and side locks -->
    <path d="M46 98 Q44 48 100 44 Q156 48 154 98 Q148 82 138 76 Q134 90 120 92 Q122 78 113 70 Q104 88 86 90 Q93 78 88 68 Q75 86 62 84 Q55 90 46 98 Z"
          fill="${HAIR}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M47 94 Q40 128 50 152 Q60 154 66 142 Q57 120 58 98 Z" fill="${HAIR}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M153 94 Q160 128 150 152 Q140 154 134 142 Q143 120 142 98 Z" fill="${HAIR}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M70 58 Q88 50 104 52" fill="none" stroke="${HAIR_LIGHT}" stroke-width="5" stroke-linecap="round"/>

    <!-- two-leaf sprout (ahoge) -->
    <g class="sprout">
      <path d="M100 46 Q98 32 102 20" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
      <path d="M102 22 Q88 6 76 14 Q86 28 102 22 Z" fill="${LEAF}" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>
      <path d="M102 22 Q114 4 128 10 Q120 26 102 22 Z" fill="${LEAF}" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>
      <path d="M100 21 Q90 16 82 15 M104 21 Q114 14 122 12" fill="none" stroke="${INK}" stroke-width="1.4" stroke-linecap="round"/>
    </g>

    <!-- flower hair clip -->
    <g transform="translate(140 66)">
      <circle cx="0" cy="-7" r="6" fill="${PINK}" stroke="${INK}" stroke-width="2"/>
      <circle cx="6.7" cy="-2.2" r="6" fill="${PINK}" stroke="${INK}" stroke-width="2"/>
      <circle cx="4.1" cy="5.7" r="6" fill="${PINK}" stroke="${INK}" stroke-width="2"/>
      <circle cx="-4.1" cy="5.7" r="6" fill="${PINK}" stroke="${INK}" stroke-width="2"/>
      <circle cx="-6.7" cy="-2.2" r="6" fill="${PINK}" stroke="${INK}" stroke-width="2"/>
      <circle cx="0" cy="0" r="4" fill="${GOLD}" stroke="${INK}" stroke-width="2"/>
    </g>
  </g>

  <!-- effects -->
  <g class="mp mp-determined fx">
    <path d="M170 40 L174 52 L186 56 L174 60 L170 72 L166 60 L154 56 L166 52 Z" fill="${GOLD}" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
  </g>
  <g class="mp mp-happy fx">
    <path d="M172 50 Q172 42 179 42 Q186 42 186 50 Q186 58 172 66 Q158 58 158 50 Q158 42 165 42 Q172 42 172 50 Z" fill="${PINK}" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
  </g>
  <g class="mp mp-worried fx">
    <path d="M160 70 Q150 86 160 92 Q170 86 160 70 Z" fill="#A8DDF2" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
  </g>
  <g class="mp mp-sleeping fx zzz" fill="${INK}" font-family="M PLUS Rounded 1c, sans-serif" font-weight="800">
    <text x="150" y="58" font-size="22">Z</text>
    <text x="170" y="38" font-size="16">z</text>
    <text x="184" y="22" font-size="12">z</text>
  </g>
</svg>`;

let girlTemplate = null;

/** A fresh <svg> of the girl. Change her mood with setMood(el, mood). */
export function createGirl(mood = "determined") {
  if (!girlTemplate) {
    const doc = new DOMParser().parseFromString(GIRL_SVG, "image/svg+xml");
    girlTemplate = doc.documentElement;
  }
  const el = document.importNode(girlTemplate, true);
  setMood(el, mood);
  return el;
}

export const MOODS = ["determined", "happy", "worried", "sleeping"];

export function setMood(el, mood) {
  el.dataset.mood = MOODS.includes(mood) ? mood : "determined";
}

/** bitty: official Here Comes Bitcoin SVGs, one per mood (see assets/characters/README.md). */
export function bittySrc(mood) {
  return `assets/characters/bitty-${MOODS.includes(mood) ? mood : "happy"}.svg`;
}
