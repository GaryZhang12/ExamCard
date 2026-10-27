# Third-Party Notices

ExamCard 1.0.0 includes the following third-party components. The Apache-2.0 license in this repository applies only to ExamCard-authored source code; it does not relicense these components or any user-imported content.

## Runtime components

| Component | Version | License | Use | Included license |
| --- | --- | --- | --- | --- |
| Electron | 43.3.0 | MIT | Desktop runtime | `licenses/Electron-LICENSE.txt` |
| Chromium (inside Electron) | Electron 43.3.0 bundle | BSD-3-Clause and other licenses | Rendering engine | `licenses/Chromium-LICENSES.html` |
| PDF.js (pdfjs-dist) | 3.11.174 | Apache-2.0 | PDF rendering/text layer | `app/pdf-libs/LICENSE`; `licenses/PDF.js-LICENSE.txt` |
| SheetJS Community Edition (`xlsx`) | 0.18.5 | Apache-2.0 | XLSX import/export | `app/libs/SheetJS-LICENSE.txt` |
| fflate | vendored UMD build (version not embedded in the minified file) | MIT | ZIP/compression | `app/libs/fflate-LICENSE.txt` |
| Tesseract.js | 7.0.0 | Apache-2.0 | Local OCR worker | `app/ocr/tesseract.js-LICENSE.txt` |
| tesseract.js-core | 7.0.0 | Apache-2.0 | OCR WASM core | `app/ocr/LICENSE` |
| @tesseract.js-data/chi_sim | 1.0.0 (model directory 4.0.0) | MIT declared by package; upstream model/data rights require review | Chinese OCR model | `app/ocr/tesseract-data-LICENSE.txt` |
| @tesseract.js-data/eng | 1.0.0 (model directory 4.0.0) | MIT declared by package; upstream model/data rights require review | English OCR model | `app/ocr/tesseract-data-LICENSE.txt` |

`licenses/Chromium-LICENSES.html` is the Chromium notice file shipped with the Electron distribution. The full Electron and Chromium license texts are also available from upstream.

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
| OCR traineddata | Included as local runtime data with license file. Upstream model-training data rights should be reviewed before highly regulated redistribution. |

## Upstream references

- Electron: https://github.com/electron/electron/blob/main/LICENSE
- Chromium: https://www.chromium.org/
- PDF.js: https://github.com/mozilla/pdf.js/blob/master/LICENSE
- SheetJS: https://github.com/SheetJS/sheetjs/blob/master/LICENSE
- fflate: https://github.com/101arrowz/fflate/blob/master/LICENSE
- Tesseract.js: https://github.com/naptha/tesseract.js/blob/master/LICENSE.md
- tesseract.js-core: https://github.com/naptha/tesseract.js-core
- tesseract.js-data: https://github.com/naptha/tessdata

The license files listed above are included in the source archive and in the packaged application resources where applicable.
