<script module lang="ts">
  /*
   * Icons. Every path comes from Lucide 0.460.0 (lucide-static,
   * https://lucide.dev), with each circle and polyline written as the same shape in path syntax.
   *
   * ISC License
   *
   * Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT).
   * All other copyright (c) for Lucide are held by Lucide Contributors 2022.
   *
   * Permission to use, copy, modify, and/or distribute this software for any purpose with or
   * without fee is hereby granted, provided that the above copyright notice and this permission
   * notice appear in all copies.
   *
   * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS
   * SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE
   * AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
   * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT,
   * NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
   * PERFORMANCE OF THIS SOFTWARE.
   */
  const ICONS = {
    /** Lucide `folder-plus`. */
    'folder-plus': [
      'M12 10v6',
      'M9 13h6',
      'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'
    ],
    /** Lucide `folder`. */
    folder: [
      'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'
    ],
    /** Lucide `search`. */
    search: ['M19 11a8 8 0 1 1-16 0 8 8 0 1 1 16 0', 'm21 21-4.3-4.3'],
    /** Lucide `plus`. */
    plus: ['M5 12h14', 'M12 5v14'],
    /** Lucide `link`. */
    link: [
      'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71',
      'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'
    ],
    /** Lucide `package`. */
    package: [
      'M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z',
      'M12 22V12',
      'm3.3 7 7.703 4.734a2 2 0 0 0 1.994 0L20.7 7',
      'm7.5 4.27 9 5.15'
    ],
    /** Lucide `cloud-download`. */
    'cloud-download': [
      'M12 13v8l-4-4',
      'm12 21 4-4',
      'M4.393 15.269A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.436 8.284'
    ],
    /** Lucide `refresh-cw`. */
    refresh: [
      'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8',
      'M21 3v5h-5',
      'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16',
      'M8 16H3v5'
    ],
    /** Lucide `sun`. */
    sun: [
      'M16 12a4 4 0 1 1-8 0 4 4 0 1 1 8 0',
      'M12 2v2',
      'M12 20v2',
      'm4.93 4.93 1.41 1.41',
      'm17.66 17.66 1.41 1.41',
      'M2 12h2',
      'M20 12h2',
      'm6.34 17.66-1.41 1.41',
      'm19.07 4.93-1.41 1.41'
    ],
    /** Lucide `moon`. */
    moon: ['M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z'],
    /** Lucide `ellipsis`. */
    ellipsis: [
      'M13 12a1 1 0 1 1-2 0 1 1 0 1 1 2 0',
      'M20 12a1 1 0 1 1-2 0 1 1 0 1 1 2 0',
      'M6 12a1 1 0 1 1-2 0 1 1 0 1 1 2 0'
    ],
    /** Lucide `info`. */
    info: ['M22 12a10 10 0 1 1-20 0 10 10 0 1 1 20 0', 'M12 16v-4', 'M12 8h.01'],
    /** Lucide `chevron-left`. */
    'chevron-left': ['m15 18-6-6 6-6'],
    /** Lucide `chevron-right`. */
    'chevron-right': ['m9 18 6-6-6-6'],
    /** Lucide `chevron-up`. */
    'chevron-up': ['m18 15-6-6-6 6'],
    /** Lucide `chevron-down`. */
    'chevron-down': ['m6 9 6 6 6-6'],
    /** Lucide `layout-grid`. */
    'layout-grid': [
      'M4 3h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z',
      'M15 3h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z',
      'M15 14h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1z',
      'M4 14h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1z'
    ],
    /** Lucide `copy`. */
    copy: [
      'M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2Z',
      'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2'
    ],
    /** Lucide `external-link`. */
    'external-link': [
      'M15 3h6v6',
      'M10 14 21 3',
      'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'
    ],
    /** Lucide `download`. */
    download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'],
    /** Lucide `rotate-ccw`. */
    'rotate-ccw': ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5'],
    /** Lucide `settings`. */
    settings: [
      'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z',
      'M15 12a3 3 0 1 1-6 0 3 3 0 1 1 6 0'
    ],
    /** Lucide `x`. */
    x: ['M18 6 6 18', 'm6 6 12 12'],
    /** Lucide `check`. */
    check: ['M20 6 9 17l-5-5'],
    /** Lucide `radio-tower`. */
    'radio-tower': [
      'M4.9 16.1C1 12.2 1 5.8 4.9 1.9',
      'M7.8 4.7a6.14 6.14 0 0 0-.8 7.5',
      'M14 9a2 2 0 1 1-4 0 2 2 0 1 1 4 0',
      'M16.2 4.8c2 2 2.26 5.11.8 7.47',
      'M19.1 1.9a9.96 9.96 0 0 1 0 14.1',
      'M9.5 18h5',
      'm8 22 4-11 4 11'
    ],
    /** Lucide `crosshair`. */
    crosshair: [
      'M22 12a10 10 0 1 1-20 0 10 10 0 1 1 20 0',
      'M22 12h-4',
      'M6 12H2',
      'M12 6V2',
      'M12 22v-4'
    ],
    /** Lucide `align-left`. */
    'align-left': ['M15 12H3', 'M17 18H3', 'M21 6H3'],
    /** Lucide `flag`. */
    flag: ['M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z', 'M4 22v-7'],
    /** Lucide `square-terminal`. */
    'square-terminal': [
      'm7 11 2-2-2-2',
      'M11 13h4',
      'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z'
    ],
    /** Lucide `panel-right`. */
    'panel-right': [
      'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
      'M15 3v18'
    ],
    /** Lucide `arrow-right`. */
    'arrow-right': ['M5 12h14', 'm12 5 7 7-7 7'],
    /** Lucide `loader-circle`. */
    /** Lucide `circle-help`. */
    'circle-help': [
      'M22 12a10 10 0 1 1-20 0 10 10 0 1 1 20 0',
      'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3',
      'M12 17h.01'
    ],
    spinner: ['M21 12a9 9 0 1 1-6.219-8.56']
  } satisfies Record<string, string[]>

  export type IconName = keyof typeof ICONS
</script>

<script lang="ts">
  let { name, size = 14 }: { name: IconName; size?: number } = $props()
</script>

<svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
  {#each ICONS[name] as d, i (i)}
    <path {d} />
  {/each}
</svg>

<style>
  svg {
    display: block;
    flex-shrink: 0;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.25;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
