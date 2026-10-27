# OCR Model Provenance — chi_sim / eng

The application bundles two compressed Tesseract traineddata files. Their SHA-256 values were verified against the upstream files on 2026-10-27.

| Bundled file | Size (bytes) | SHA-256 |
| --- | ---: | --- |
| `app/ocr/chi_sim.traineddata.gz` | 20,159,757 | `59388039851E4D1293D729C183FD8C1FA9BBBB959EED996E945024671E68C1D6` |
| `app/ocr/eng.traineddata.gz` | 10,923,060 | `ED350F3752F81EE8F38769EDC14D92D997DABABE23B565C59879372CC46A2468` |

## Upstream files

The bundled bytes are identical to the following files from the `naptha/tessdata` repository, `gh-pages` branch, model directory `4.0.0`:

- https://raw.githubusercontent.com/naptha/tessdata/gh-pages/4.0.0/chi_sim.traineddata.gz
- https://raw.githubusercontent.com/naptha/tessdata/gh-pages/4.0.0/eng.traineddata.gz

The `naptha/tessdata` repository includes `tesseract-ocr/tessdata_fast` as its upstream submodule. The traineddata is therefore attributed to the Tesseract `tessdata_fast` model set (model directory 4.0.0).

## npm package wrapper

- `@tesseract.js-data/chi_sim@1.0.0`
- `@tesseract.js-data/eng@1.0.0`

Both npm packages declare `"license": "MIT"` in their package metadata and point to `https://github.com/naptha/tessdata`. The wrapper/package metadata license is MIT; the traineddata upstream repository `tesseract-ocr/tessdata_fast` is licensed **Apache-2.0**. Both applicable texts are included:

- `licenses/tesseract.js-data-LICENSE.txt` — npm package MIT declaration/text
- `licenses/tessdata-fast-LICENSE.txt` — upstream Apache-2.0 license

Attribution: Tesseract OCR and tessdata_fast contributors. No modifications were made to the traineddata files.

The SHA-256 values above are the actual packaged model hashes; they are not hashes of the npm package wrapper.