# Third-Party Notices

ExamCard 1.0.0 includes the following third-party components. The Apache-2.0 license in this repository applies only to ExamCard-authored source code; it does not relicense these components or any user-imported content.

## Runtime components

| Component | Version | License | Use | Evidence / included license |
| --- | --- | --- | --- | --- |
| Electron | 43.3.0 | MIT | Desktop runtime | `licenses/Electron-LICENSE.txt` |
| Chromium (inside Electron) | Electron 43.3.0 bundle | BSD-3-Clause and other notices | Rendering engine | `licenses/Chromium-LICENSES.html` |
| PDF.js (pdfjs-dist) | 3.11.174 | Apache-2.0 | PDF rendering/text layer | `app/pdf-libs/LICENSE`; `licenses/PDF.js-LICENSE.txt` |
| SheetJS Community Edition (`xlsx`) | 0.18.5 | Apache-2.0 | XLSX import/export | `app/libs/SheetJS-LICENSE.txt` |
| fflate | **0.8.2** | MIT | ZIP/compression | file SHA-256 `C3B34F2E9F5E74D4D7D64E01CAC7A0C01954C6C406414D42185C7B53D6875DDF`; matches upstream `fflate@0.8.2/umd/index.js`; `app/libs/fflate-LICENSE.txt` |
| Tesseract.js | 7.0.0 | Apache-2.0 | Local OCR worker | `app/ocr/tesseract.js-LICENSE.txt` |
| tesseract.js-core | 7.0.0 | Apache-2.0 | OCR WASM core | `app/ocr/LICENSE` |
| @tesseract.js-data/chi_sim | 1.0.0 (model dir 4.0.0) | npm package metadata MIT; **upstream traineddata Apache-2.0** | Chinese OCR model | SHA-256 `59388039851E4D1293D729C183FD8C1FA9BBBB959EED996E945024671E68C1D6`; `licenses/OCR-MODELS.md`, `licenses/tessdata-fast-LICENSE.txt` |
| @tesseract.js-data/eng | 1.0.0 (model dir 4.0.0) | npm package metadata MIT; **upstream traineddata Apache-2.0** | English OCR model | SHA-256 `ED350F3752F81EE8F38769EDC14D92D997DABABE23B565C59879372CC46A2468`; `licenses/OCR-MODELS.md`, `licenses/tessdata-fast-LICENSE.txt` |

`licenses/Chromium-LICENSES.html` is the Chromium notice file shipped with the Electron distribution. The full Electron and Chromium license texts are also available from upstream.

## OCR model provenance

The two packaged `traineddata.gz` files are byte-for-byte identical to `naptha/tessdata` (`gh-pages`, path `4.0.0/`) and use the Tesseract `tessdata_fast` 4.0.0 model set. Full file names, sizes, SHA-256 values, upstream URLs and license texts are in `licenses/OCR-MODELS.md`. The npm wrapper packages declare MIT; the traineddata upstream repository is Apache-2.0.

## Build tooling (not shipped as runtime dependency)

| Component | Version | License |
| --- | --- | --- |
| electron-builder | 26.18.0 | MIT |

## Assets and content

| Item | Status |
| --- | --- |
| ExamCard name, logo, wordmark, icon and other brand assets | **Not licensed under Apache-2.0.** All rights reserved by the project owner; public redistribution requires owner authorization. |
| User-imported exam PDFs, textbooks, courses and question sets | Not included in this repository or installer. Users are responsible for having the right to use imported files. |
| Bundled real-exam PDFs or Base64 exam data | **Removed in 1.0.0.** No real-exam PDFs, commercial textbook content or course videos are distributed. |
| OCR traineddata | Included as local runtime data; upstream license text and exact SHA-256 are included in `licenses/`. |

## Upstream references

- Electron: https://github.com/electron/electron/blob/main/LICENSE
- Chromium: https://www.chromium.org/
- PDF.js: https://github.com/mozilla/pdf.js/blob/master/LICENSE
- SheetJS: https://github.com/SheetJS/sheetjs/blob/master/LICENSE
- fflate: https://github.com/101arrowz/fflate/blob/master/LICENSE
- fflate 0.8.2 UMD source: https://unpkg.com/fflate@0.8.2/umd/index.js
- Tesseract.js: https://github.com/naptha/tesseract.js/blob/master/LICENSE.md
- tesseract.js-core: https://github.com/naptha/tesseract.js-core
- tesseract.js-data: https://github.com/naptha/tessdata
- tessdata_fast license: https://github.com/tesseract-ocr/tessdata_fast/blob/main/LICENSE

The license files listed above are included in the source archive and in the packaged application resources where applicable.
