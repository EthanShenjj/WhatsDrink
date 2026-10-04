# Province boundary asset

`province-boundaries.json` is a simplified derivative of
[`china_province_full.geojson`](https://github.com/Supeset/China-GeoData/blob/main/geojson/china_province_full.geojson)
from Supeset/China-GeoData, licensed under MIT (© 2025 圈集).

The source contains 34 provincial administrative regions, including Taiwan,
Hong Kong and Macau. The separate decorative nine-dash-line feature is omitted
because it is not a tappable province. Outer rings are simplified for the mini
program; very small outlying islands and interior holes are omitted. The layer
is for visual progress, not precise administrative or navigational use.

Regenerate from a downloaded source file with:

`python3 scripts/build-province-boundaries.py /path/to/china_province_full.geojson`

The script also writes `province-boundaries.ts`, which the mini program imports.
The WeChat runtime does not load JSON imported directly from a TypeScript module.

## Upstream MIT license

Copyright (c) 2025 圈集

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
