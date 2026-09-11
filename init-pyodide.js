/**
 * @fileoverview Main orchestration script for parsing Oregon DHS ISP PDF documents.
 * Initializes the Pyodide WebAssembly Python environment, extracts spatial 
 * layout geometry/text via `pdfminer.six`, performs canvas-based checkbox state 
 * evaluation, and maps extracted elements into structured JSON payloads.
 */

/**
 * Global reference to the initialized Pyodide WASM runtime instance.
 * @type {Object|null}
 */
let pyodide = null;

// Set up PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = "lib/pdf.worker.min.js";
//pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

/**
 * Global state object holding references to active PDF processing data.
 * @type {Object}
 * @property {File|null} file - The uploaded PDF file object.
 * @property {ArrayBuffer|null} arrayBuffer - Raw binary buffer of the active PDF.
 * @property {Object|null} pdfDoc - PDF.js document handle instance.
 * @property {Array<Object>} parsedPages - Array of extracted and evaluated page data structures.
 */
window.pdfState = {
    file: null,
    arrayBuffer: null,
    pdfDoc: null,
    parsedPages: [],
};

/**
 * Asynchronously initializes the Pyodide WASM environment.
 * Loads the WebAssembly runtime, mounts the `micropip` package manager,
 * and installs the custom `pdfminer.six` wheel file for PDF layout extraction.
 * Updates UI status indicators upon completion or failure.
 * 
 * @async
 * @function initPyodide
 * @returns {Promise<void>} Resolves when Pyodide environment setup is complete.
 */
async function initPyodide() {
    const status = document.getElementById("status");
    const btn = document.getElementById("extractBtn");

    try {
        status.innerText = "Loading Pyodide runtime...";
        pyodide = await loadPyodide();

        status.innerText = "Loading micropip package manager...";
        await pyodide.loadPackage("micropip");
        const micropip = pyodide.pyimport("micropip");

        status.innerText = "Installing pdfminer.six engine...";
        await micropip.install("./lib/pdfminer_six-20260107-py3-none-any.whl");

        status.innerText = "Ready!";
        btn.disabled = false;
        btn.innerText = "Process PDF";
        document.getElementById("dynamicsOutput").innerText = "Ready to parse PDF locally.";
        document.getElementById("rawOutput").innerText = "Ready to parse PDF locally.";
    } catch (err) {
        console.error("Pyodide Init Error:", err);
        status.innerText = "Failed to load Pyodide environment.";
        document.getElementById("dynamicsOutput").innerText = err.message;
    }
}

initPyodide();

/**
 * Main event handler and orchestration pipeline for processing a user-selected PDF.
 * 
 * Executable Workflow Steps:
 * 1. Reads input file buffer into memory.
 * 2. Initializes rendering context with PDF.js.
 * 3. Executes Python code in Pyodide to extract layout elements (text containers, 
 *    checkboxes/radio controls, vertical/horizontal rules) via `pdfminer.six`.
 * 4. Performs canvas pixel inspection to evaluate input control selections.
 * 5. Maps extracted layout primitives into an extended target JSON schema.
 * 6. Triggers rendering of the SVG debug visualizer overlay.
 * 
 * @async
 * @function processPdf
 * @returns {Promise<void>} Resolves when PDF extraction, evaluation, and rendering are completed.
 */
async function processPdf() {
    const fileInput = document.getElementById("pdfFile");
    const status = document.getElementById("status");
    const btn = document.getElementById("extractBtn");
    const dynamicsOutput = document.getElementById("dynamicsOutput");
    const rawOutput = document.getElementById("rawOutput");

    if (!fileInput.files.length) {
        alert("Please select a PDF file first.");
        return;
    }

    btn.disabled = true;

    try {
        const file = fileInput.files[0];
        const arrayBuffer = await file.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        // Load PDF.js Document Instance
        status.innerText = "Loading PDF.js rendering context...";
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer.slice(0) });
        const pdfDoc = await loadingTask.promise;
        window.pdfState.pdfDoc = pdfDoc;
        window.pdfState.arrayBuffer = arrayBuffer;

        // Run Python Vector & Text Extraction via Pyodide
        status.innerText = "Extracting layout geometry & text via Pyodide...";
        pyodide.FS.writeFile("input_isp.pdf", uint8Array);

        /**
         * Inline Python script executed inside Pyodide.
         * Contains structural vector extraction logic and geometry layout analysis.
         * 
         * Inner Python Functions:
         * - merge_lines(shapes, tolerance, min_length): Deduplicates and merges contiguous line segments.
         * - process_element(element, page_num, page_h, footer_y, y_offset, shapes, text_blocks): Recursively traverses 
         *   pdfminer layout elements to extract form controls, boundaries, and text content.
         */
        const pythonCode = `
import json
from pdfminer.high_level import extract_pages
from pdfminer.layout import (
    LTTextContainer, LAParams, LTRect, LTCurve, LTLine, LTContainer
)

def merge_lines(shapes, tolerance=2.0, min_length=15.0):
    controls = [s for s in shapes if s["type"] in ("checkbox", "radio")]
    h_lines = [s for s in shapes if s["type"] == "h_line"]
    v_lines = [s for s in shapes if s["type"] == "v_line"]

    merged_h, merged_v = [], []

    h_groups = {}
    for l in h_lines:
        bucket = round(l["global_y"] / tolerance)
        h_groups.setdefault(bucket, []).append(l)

    for lines in h_groups.values():
        lines.sort(key=lambda item: item["x0"])
        curr = None
        for l in lines:
            if curr is None:
                curr = dict(l)
            elif l["x0"] <= curr["x1"] + tolerance:
                curr["x1"] = max(curr["x1"], l["x1"])
            else:
                if (curr["x1"] - curr["x0"]) >= min_length:
                    merged_h.append(curr)
                curr = dict(l)
        if curr and (curr["x1"] - curr["x0"]) >= min_length:
            merged_h.append(curr)

    v_groups = {}
    for l in v_lines:
        bucket = round(l["global_x"] / tolerance)
        v_groups.setdefault(bucket, []).append(l)

    for lines in v_groups.values():
        lines.sort(key=lambda item: item["global_y0"])
        curr = None
        for l in lines:
            if curr is None:
                curr = dict(l)
            elif l["global_y0"] <= curr["global_y1"] + tolerance:
                curr["global_y1"] = max(curr["global_y1"], l["global_y1"])
                curr["y1"] = max(curr["y1"], l["y1"])
            else:
                if (curr["global_y1"] - curr["global_y0"]) >= min_length:
                    merged_v.append(curr)
                curr = dict(l)
        if curr and (curr["global_y1"] - curr["global_y0"]) >= min_length:
            merged_v.append(curr)

    return controls + merged_h + merged_v


def process_element(element, page_num, page_h, footer_y, y_offset, shapes, text_blocks):
    if isinstance(element, LTContainer) and not isinstance(element, LTTextContainer):
        for child in element:
            process_element(child, page_num, page_h, footer_y, y_offset, shapes, text_blocks)
        return

    local_top = round(page_h - element.y1, 2)
    local_bottom = round(page_h - element.y0, 2)
    if local_bottom > footer_y:
        return

    x0, x1 = round(element.x0, 2), round(element.x1, 2)
    global_top = round(y_offset + local_top, 2)
    global_bottom = round(y_offset + local_bottom, 2)

    local_bbox = [x0, local_top, x1, local_bottom]
    global_bbox = [x0, global_top, x1, global_bottom]

    if isinstance(element, (LTRect, LTCurve, LTLine)):
        w, h = round(element.width, 1), round(element.height, 1)

        if 6.0 <= w <= 20.0 and 6.0 <= h <= 20.0:
            shapes.append({
                "type": "checkbox" if isinstance(element, LTRect) else "radio",
                "bbox": local_bbox,
                "global_bbox": global_bbox,
                "is_checked": False,
                "page": page_num
            })
        else:
            mid_y = round((local_top + local_bottom) / 2, 2)
            mid_gy = round((global_top + global_bottom) / 2, 2)
            mid_x = round((x0 + x1) / 2, 2)

            if h <= 2.0 and w > 20.0:
                shapes.append({"type": "h_line", "x0": x0, "x1": x1, "y0": mid_y, "y1": mid_y, "global_y": mid_gy, "page": page_num})
            elif w <= 2.0 and h > 20.0:
                shapes.append({"type": "v_line", "x": mid_x, "global_x": mid_x, "y0": local_top, "y1": local_bottom, "global_y0": global_top, "global_y1": global_bottom, "page": page_num})
            elif w > 20.0 and h > 20.0:
                shapes.extend([
                    {"type": "h_line", "x0": x0, "x1": x1, "y0": local_top, "y1": local_top, "global_y": global_top, "page": page_num},
                    {"type": "h_line", "x0": x0, "x1": x1, "y0": local_bottom, "y1": local_bottom, "global_y": global_bottom, "page": page_num},
                    {"type": "v_line", "x": x0, "global_x": x0, "y0": local_top, "y1": local_bottom, "global_y0": global_top, "global_y1": global_bottom, "page": page_num},
                    {"type": "v_line", "x": x1, "global_x": x1, "y0": local_top, "y1": local_bottom, "global_y0": global_top, "global_y1": global_bottom, "page": page_num}
                ])

    elif isinstance(element, LTTextContainer):
        text = element.get_text().strip()
        if text and not text.startswith("Person receiving services:"):
            text_blocks.append({
                "text": text,
                "bbox": local_bbox,
                "global_bbox": global_bbox,
                "has_check_symbol": any(c in text for c in ['[X]', '[x]', '☑', '■', '✔']),
                "page": page_num
            })

parsed_pages = []
current_y_offset = 0.0
laparams = LAParams(line_margin=0.2, word_margin=0.1, boxes_flow=None)

for page_layout in extract_pages("input_isp.pdf", laparams=laparams):
    page_num = page_layout.pageid
    raw_shapes, text_blocks = [], []
    page_h = page_layout.height
    footer_y = page_h - 24.0

    for element in page_layout:
        process_element(element, page_num, page_h, footer_y, current_y_offset, raw_shapes, text_blocks)

    parsed_pages.append({
        "page": page_num,
        "page_height": page_h,
        "shapes": merge_lines(raw_shapes, tolerance=2.0, min_length=15.0),
        "text_blocks": text_blocks
    })

    current_y_offset += page_h

json.dumps(parsed_pages)
`;

        const jsonString = await pyodide.runPythonAsync(pythonCode);
        const rawParsedPages = JSON.parse(jsonString);

        // Run Canvas Pixel Inspection & Grouping
        status.innerText = "Evaluating form checkbox states via Canvas...";
        const evaluatedPages = await processCanvasFormControls(pdfDoc, rawParsedPages);

        window.pdfState.parsedPages = evaluatedPages;
        rawOutput.innerText = JSON.stringify(evaluatedPages, null, 2);

        // Map JSON Schema against Evaluated Controls
        status.innerText = "Mapping PDF data...";
        const schemaPayload = await matchExtendedPCISchema(evaluatedPages);
        dynamicsOutput.innerText = JSON.stringify(schemaPayload, null, 2);

        status.innerText = "Parsing Complete!";

        // Render Debug Visualizer SVG Overlay
        if (typeof renderParsedPdfSvg === "function") {
            await renderParsedPdfSvg(evaluatedPages, "debug-visualizer-container", pdfDoc, {
                bgOpacity: 0.65,
                showCheckboxes: true,
                showText: true,
            });
        }
    } catch (err) {
        console.error("Pipeline Execution Error:", err);
        status.innerText = "Error processing PDF.";
        dynamicsOutput.innerText = err.message;
    } finally {
        btn.disabled = false;
    }
}