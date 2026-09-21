/**
 * @fileoverview Utility functions for UI interactions, regex string matching,
 * layout section isolation, table line/cell reconstruction, coordinate-based text mapping,
 * shape deduplication, and canvas-based checkbox pixel evaluation for Oregon DHS ISP PDFs.
 */

/**
 * Updates the UI file name label element when a user selects a file via the input element.
 *
 * @function updateFileName
 * @returns {void}
 */
function updateFileName() {
    const input = document.getElementById("pdfFile");
    if (input.files.length > 0) {
        document.getElementById("fileName").innerText = input.files[0].name;
    }
}

/**
 * Copies the raw JSON string present in the `#dynamicsOutput` element to the system clipboard.
 *
 * @function copyPayload
 * @returns {void}
 */
function copyPayload() {
    const content = document.getElementById("dynamicsOutput").innerText;
    navigator.clipboard.writeText(content);
    alert("Payload copied to clipboard!");
}

/**
 * Exports and downloads the generated structured JSON output as a `.json` file,
 * deriving the output filename from the input PDF filename.
 *
 * @function downloadPayload
 * @returns {void}
 */
function downloadPayload() {
  const content = document.getElementById("dynamicsOutput").innerText;
  const blob = new Blob([content], { type: 'application/json' });
  const fileUrl = URL.createObjectURL(blob);
  
  const hiddenAnchor = document.createElement('a');
  hiddenAnchor.href = fileUrl;
  hiddenAnchor.download = document.getElementById("fileName").innerText.replace(/\.pdf/gi, '.json'); // The filename
  
  document.body.appendChild(hiddenAnchor);
  hiddenAnchor.click();
  document.body.removeChild(hiddenAnchor);
  URL.revokeObjectURL(fileUrl); // Clear memory
};

/**
 * Matches a Regular Expression against a target text string and returns the first capture group.
 *
 * @function matchPattern
 * @param {string} text - The input text string to search.
 * @param {RegExp} regex - Regular Expression pattern containing at least one capture group.
 * @returns {string|null} The trimmed string content of capture group 1, or `null` if no match is found.
 */
function matchPattern(text, regex) {
    const m = text.match(regex);
    return m ? m[1].trim() : null;
}

/**
 * Isolates a subset of text blocks bounded between two section header markers.
 *
 * @function isolateSection
 * @param {Array<Object>} allBlocks - Array of text block objects with a `.text` property.
 * @param {string} sectionHeader - The prefix string that denotes the start of the section.
 * @param {string} nextSectionHeader - The prefix string that denotes the start of the following section.
 * @returns {Array} Tuple containing `[secBlocks, secText, endBlock]` where:
 *   - `secBlocks` {Array<Object>} List of text blocks within the section bounds.
 *   - `secText` {string} Multiline newline-joined text of all isolated blocks.
 *   - `endBlock` {Object|null} The block that triggered the section end, if matched.
 */
function isolateSection(allBlocks, sectionHeader, nextSectionHeader, options = {sortBlocksFirst: false, useRegex: false}) {
    let secBlocks = [];
    let inSec = false;
    let endBlock = null;
    let parseBlocks = allBlocks;

    if (options.sortBlocksFirst !== false) {
        parseBlocks = parseBlocks.sort((a, b) => Math.round(a.bbox[0] / options.sortBlocksFirst) - Math.round(b.bbox[0] / options.sortBlocksFirst));
        parseBlocks = parseBlocks.sort((a, b) => Math.round(a.global_bbox[1] / options.sortBlocksFirst) - Math.round(b.global_bbox[1] / options.sortBlocksFirst));
    }

    if (options.useRegex) {
        parseBlocks.forEach((b) => {
            const txt = b.text.trim();
            if (sectionHeader.test(b.text) && !endBlock) {
                inSec = true;
            }
            if (nextSectionHeader.test(b.text)) {
                inSec = false;
                endBlock = b;
            }
            if (inSec) {
                secBlocks.push(b);
            }
        });    
    } else {
        parseBlocks.forEach((b) => {
            const txt = b.text.trim();
            if (b.text.trim().startsWith(sectionHeader) && !endBlock) {
                inSec = true;
            }
            if (b.text.trim().startsWith(nextSectionHeader)) {
                inSec = false;
                endBlock = b;
            }
            if (inSec) {
                secBlocks.push(b);
            }
        });
    }

    const lines = secBlocks.map((b) => b.text);
    const secText = lines.join("\n");

    return [secBlocks, secText, endBlock];
}

/**
 * Filters and sorts table lines strictly contained within specified global coordinate ranges.
 *
 * @function getLinesInRange
 * @param {Array<Object>} shapes - The 'shapes' array from parsed pages (or concatenated shapes across pages).
 * @param {Object} [options={}] - Configuration options for range filtering.
 * @param {string} options.type - 'horizontal' ('h') or 'vertical' ('v').
 * @param {Array<number>} [options.xRange] - [minX, maxX] global X range constraint.
 * @param {Array<number>} [options.yRange] - [minY, maxY] global Y range constraint.
 * @param {number} [options.page] - Optional page number filter.
 * @param {number} [options.tolerance=1.0] - Coordinate matching tolerance (in pt).
 * @throws {Error} Throws if the `type` parameter is not valid horizontal or vertical line designations.
 * @returns {Array<Object>} Sorted list of matching line objects.
 */
function getLinesInRange(shapes, options = {}) {
    const { type, xRange, yRange, page, tolerance = 1.0 } = options;

    const isH = type === "horizontal" || type === "h" || type === "h_line";
    const isV = type === "vertical" || type === "v" || type === "v_line";

    if (!isH && !isV) {
        throw new Error("Invalid type parameter. Must be 'horizontal' ('h') or 'vertical' ('v').");
    }

    const targetType = isH ? "h_line" : "v_line";

    return shapes
        .filter((shape) => {
            // 1. Filter by shape type
            if (shape.type !== targetType) return false;

            // 2. Optional Page filter
            if (page !== undefined && shape.page !== page) return false;

            // Resolve global coordinates safely across all schema variations
            const lineX0 = isH
                ? (shape.global_x0 ?? shape.x0 ?? shape.global_x ?? shape.x)
                : (shape.global_x ?? shape.x ?? shape.global_x0 ?? shape.x0);

            const lineX1 = isH
                ? (shape.global_x1 ?? shape.x1 ?? shape.global_x ?? shape.x)
                : (shape.global_x ?? shape.x ?? shape.global_x1 ?? shape.x1);

            const lineY0 = isH
                ? (shape.global_y ?? shape.global_y0 ?? shape.y0)
                : (shape.global_y0 ?? shape.y0 ?? shape.global_y ?? shape.y);

            const lineY1 = isH
                ? (shape.global_y ?? shape.global_y1 ?? shape.y1)
                : (shape.global_y1 ?? shape.y1 ?? shape.global_y ?? shape.y);

            // Normalize start/end coordinates
            const startX = Math.min(lineX0, lineX1);
            const endX = Math.max(lineX0, lineX1);
            const startY = Math.min(lineY0, lineY1);
            const endY = Math.max(lineY0, lineY1);

            // Guard against NaN
            if (isNaN(startX) || isNaN(endX) || isNaN(startY) || isNaN(endY)) {
                return false;
            }

            // 3. Filter by X Range [minX, maxX] - Overlap Check for H-Lines, Span Check for V-Lines
            if (xRange && xRange.length === 2) {
                const [minX, maxX] = xRange;
                if (isH) {
                    // Horizontal lines must OVERLAP with the requested X window
                    const overlapsX = startX <= maxX + tolerance && endX >= minX - tolerance;
                    if (!overlapsX) return false;
                } else {
                    // Vertical lines must lie WITHIN the X coordinate position
                    const insideX = startX >= minX - tolerance && endX <= maxX + tolerance;
                    if (!insideX) return false;
                }
            }

            // 4. Filter by Y Range [minY, maxY] - Overlap Check for V-Lines, Span Check for H-Lines
            if (yRange && yRange.length === 2) {
                const [minY, maxY] = yRange;
                if (isV) {
                    // Vertical lines must OVERLAP with the requested Y window across pages
                    const overlapsY = startY <= maxY + tolerance && endY >= minY - tolerance;
                    if (!overlapsY) return false;
                } else {
                    // Horizontal lines must lie WITHIN the Y coordinate position
                    const insideY = startY >= minY - tolerance && endY <= maxY + tolerance;
                    if (!insideY) return false;
                }
            }

            return true;
        })
        .sort((a, b) => {
            const getGy = (s) => s.global_y ?? s.global_y0 ?? s.y0 ?? 0;
            const getGx = (s) => s.global_x ?? s.global_x0 ?? s.x0 ?? 0;

            if (isH) {
                const diffY = getGy(a) - getGy(b);
                if (Math.abs(diffY) > tolerance) return diffY;
                return getGx(a) - getGx(b);
            } else {
                const diffX = getGx(a) - getGx(b);
                if (Math.abs(diffX) > tolerance) return diffX;
                return getGy(a) - getGy(b);
            }
        });
}

/**
 * Converts pre-filtered and pre-sorted table line arrays into structured cell bounding boxes.
 *
 * @function generateCellBoundingBoxes
 * @param {Array<Object>} tables - Array of table objects containing clean `h_lines` and `v_lines` arrays.
 * @returns {Array<Object>} Processed table structures containing rows and individual cell bounding boxes.
 */
function generateCellBoundingBoxes(tables) {
    return tables.map((table, tableIndex) => {
        // 1. Group lines by page to prevent page 6 horizontal lines pairing with page 7 vertical lines
        const pages = [...new Set([...table.h_lines.map((l) => l.page), ...table.v_lines.map((l) => l.page)])]
            .filter(Boolean)
            .sort((a, b) => a - b);

        const allGeneratedRows = [];

        pages.forEach((pageNum) => {
            const pageHLines = table.h_lines
                .filter((l) => l.page === pageNum)
                .sort((a, b) => (a.global_y ?? a.y0) - (b.global_y ?? b.y0));

            const rawVLines = table.v_lines.filter((l) => l.page === pageNum);

            // 2. Deduplicate vertical lines on this page by X-coordinate to get true column boundaries
            const uniqueXMap = new Map();
            rawVLines.forEach((vl) => {
                const xVal = vl.x ?? vl.x0;
                if (!uniqueXMap.has(xVal)) {
                    uniqueXMap.set(xVal, vl);
                }
            });

            const pageVLines = Array.from(uniqueXMap.values()).sort((a, b) => (a.x ?? a.x0) - (b.x ?? b.x0));

            const numRows = pageHLines.length - 1;
            const numCols = pageVLines.length - 1;

            if (numRows <= 0 || numCols <= 0) return;

            for (let r = 0; r < numRows; r++) {
                const topH = pageHLines[r];
                const bottomH = pageHLines[r + 1];
                const cells = [];

                for (let c = 0; c < numCols; c++) {
                    const leftV = pageVLines[c];
                    const rightV = pageVLines[c + 1];

                    const x0 = leftV.x ?? leftV.x0;
                    const x1 = rightV.x ?? rightV.x0;
                    const y0 = topH.y ?? topH.y0;
                    const y1 = bottomH.y ?? bottomH.y0;

                    const globalX0 = leftV.global_x ?? leftV.global_x0 ?? x0;
                    const globalX1 = rightV.global_x ?? rightV.global_x0 ?? x1;
                    const globalY0 = topH.global_y ?? topH.global_y0 ?? y0;
                    const globalY1 = bottomH.global_y ?? bottomH.global_y0 ?? y1;

                    cells.push({
                        tableIndex,
                        rowIndex: allGeneratedRows.length,
                        colIndex: c,
                        page: pageNum,
                        bbox: {
                            x0,
                            x1,
                            y0,
                            y1,
                            width: Number((x1 - x0).toFixed(2)),
                            height: Number((y1 - y0).toFixed(2)),
                        },
                        globalBbox: {
                            x0: globalX0,
                            x1: globalX1,
                            y0: globalY0,
                            y1: globalY1,
                            width: Number((globalX1 - globalX0).toFixed(2)),
                            height: Number((globalY1 - globalY0).toFixed(2)),
                        },
                    });
                }

                allGeneratedRows.push({
                    rowIndex: allGeneratedRows.length,
                    isHeader: allGeneratedRows.length === 0,
                    page: pageNum,
                    cells,
                });
            }
        });

        return {
            tableIndex,
            rowCount: allGeneratedRows.length,
            colCount: allGeneratedRows[0] ? allGeneratedRows[0].cells.length : 0,
            rows: allGeneratedRows,
        };
    });
}

/**
 * Maps text blocks into table cell bounding boxes and transforms rows into structured objects.
 *
 * @function mapTextToTableRows
 * @param {Object} tableGrid - Single table object output from `generateCellBoundingBoxes`.
 * @param {Array<Object>} textBlocks - Array of text block objects with spatial bounding box coordinates.
 * @param {Array<string>} columnKeys - Ordered list of output object keys corresponding to columns.
 * @param {Object} [options={}] - Additional configuration options.
 * @param {number} [options.tolerance=2.0] - Point tolerance for bounding box containment.
 * @param {string} [options.joinStr=" "] - Delimiter string used when concatenating multi-line text within a cell.
 * @returns {Array<Object>} List of structured row objects mapping cell values to column keys.
 */
function mapTextToTableRows(tableGrid, textBlocks, columnKeys, options = {}) {
    const { tolerance = 2.0 } = options;

    // 1. Group text blocks into cells based on spatial containment
    const cellMap = new Map(); // Key: "rowIndex,colIndex" -> Array of text strings

    for (const block of textBlocks) {
        // Extract block coordinates (prefer global coordinates if available)
        const bX0 = block.global_bbox[0];
        const bX1 = block.global_bbox[2];
        const bY0 = block.global_bbox[1];
        const bY1 = block.global_bbox[3];

        // Center point of the text block for robust placement
        const midX = (bX0 + bX1) / 2;
        const midY = (bY0 + bY1) / 2;

        // Find target cell across all rows
        for (const row of tableGrid.rows) {
            for (const cell of row.cells) {
                const box = cell.globalBbox ?? cell.bbox;

                // Check if block center falls inside cell bounding box (with tolerance)
                const insideX = midX >= box.x0 - tolerance && midX <= box.x1 + tolerance;
                const insideY = midY >= box.y0 - tolerance && midY <= box.y1 + tolerance;

                if (insideX && insideY) {
                    const key = `${cell.rowIndex},${cell.colIndex}`;
                    if (!cellMap.has(key)) cellMap.set(key, []);
                    cellMap.get(key).push({
                        text: block.text,
                        top: bY0,
                        left: bX0,
                    });
                    break;
                }
            }
        }
    }

    // 2. Map cells into output row objects (skipping header row 0)
    const tableRows = [];

    for (const row of tableGrid.rows) {
        if (row.isHeader) continue; // Skip header row

        const rowObject = {};

        row.cells.forEach((cell, cIndex) => {
            const colKey = columnKeys[cIndex];
            if (!colKey) return; // Skip if column exceeds provided keys array

            const cellKey = `${cell.rowIndex},${cell.colIndex}`;
            const blocksInCell = cellMap.get(cellKey) || [];

            // Sort text blocks top-to-bottom, left-to-right within cell
            blocksInCell.sort((a, b) => {
                if (Math.abs(a.top - b.top) > 3) return a.top - b.top;
                return a.left - b.left;
            });

            // Join multi-line cell content with clean whitespace
            rowObject[colKey] = blocksInCell
                .map((b) => b.text.trim())
                .filter(Boolean)
                .join(options.joinStr ?? " ");
        });

        tableRows.push(rowObject);
    }

    return tableRows;
}

/**
 * Deduplicates overlapping vector controls (e.g., stacked rects/curves),
 * retaining only the largest parent bounding box per region.
 *
 * @function groupShapesByLargestParent
 * @param {Array<Object>} shapes - Raw shapes extracted from PDF page.
 * @param {Object} [options={}] - Clustering options.
 * @param {number} [options.maxCentroidDistance=12.0] - Max Euclidean distance between centroids to merge overlapping controls.
 * @returns {Array<Object>} Deduplicated top-level control objects.
 */
function groupShapesByLargestParent(shapes, options = {}) {
    const { maxCentroidDistance = 12.0 } = options;

    const parseBBox = (raw) => {
        if (!raw) return [0, 0, 0, 0];
        if (Array.isArray(raw)) return raw;
        return [raw.x0, raw.y0, raw.x1, raw.y1];
    };

    // 1. Normalize shapes (keep bounding boxes as clean standard arrays [x0, y0, x1, y1])
    const normalized = shapes.map((shape) => {
        const local = parseBBox(shape.bbox);
        const global = parseBBox(shape.global_bbox);

        const width = shape.width ?? Math.abs(local[2] - local[0]);
        const height = shape.height ?? Math.abs(local[3] - local[1]);

        return {
            type: shape.type ?? "checkbox",
            page: shape.page,
            width,
            height,
            area: width * height,
            bbox: local,
            global_bbox: global,
            centroid: {
                x: (global[0] + global[2]) / 2,
                y: (global[1] + global[3]) / 2,
            },
            is_checked: Boolean(shape.is_checked),
        };
    });

    // 2. Spatial Clustering: Keep ONLY the largest container shape per cluster
    const topLevelControls = [];
    const visited = new Set();

    for (let i = 0; i < normalized.length; i++) {
        if (visited.has(i)) continue;

        let largest = normalized[i];
        visited.add(i);

        for (let j = i + 1; j < normalized.length; j++) {
            if (visited.has(j)) continue;

            const candidate = normalized[j];

            // Check distance between centroids
            const dx = largest.centroid.x - candidate.centroid.x;
            const dy = largest.centroid.y - candidate.centroid.y;
            const dist = Math.hypot(dx, dy);

            if (dist <= maxCentroidDistance) {
                visited.add(j);
                // Replace if candidate represents a larger bounding area
                if (candidate.area > largest.area) {
                    largest = candidate;
                }
            }
        }

        // Retain only top-level fields needed for canvas evaluation
        topLevelControls.push({
            type: largest.type,
            page: largest.page,
            bbox: largest.bbox,
            global_bbox: largest.global_bbox,
            is_checked: largest.is_checked,
        });
    }

    return topLevelControls;
}

/**
 * Coordinates form control extraction across pages, deduplicating controls and invoking canvas inspection.
 *
 * @async
 * @function processCanvasFormControls
 * @param {Object} pdfDoc - Active PDF.js document instance.
 * @param {Array<Object>} parsedPages - Parsed pages array containing shape vectors and text blocks.
 * @param {number} [scale=2.0] - Render resolution multiplier for canvas pixel sampling.
 * @returns {Promise<Array<Object>>} Resolved pages array with evaluated shape states.
 */
async function processCanvasFormControls(pdfDoc, parsedPages, scale = 2.0) {
    for (const pageObj of parsedPages) {
        const pageNum = pageObj.page;

        // 1. Isolate controls and structural elements
        const rawControls = pageObj.shapes.filter((s) => s.type === "checkbox" || s.type === "radio");
        const nonControlShapes = pageObj.shapes.filter((s) => s.type !== "checkbox" && s.type !== "radio");

        if (rawControls.length > 0) {
            // 2. Deduplicate shapes first (removes nested/overlapping vector duplicates)
            const uniqueControls = groupShapesByLargestParent(rawControls, { maxCentroidDistance: 12.0 });

            // 3. Evaluate pixels ONLY on unique controls
            const pdfPage = await pdfDoc.getPage(pageNum);
            const evaluatedControls = await evaluateControlsWithCanvas(pdfPage, uniqueControls, scale);

            // 4. Overwrite pageObj.shapes so all subsequent steps only see clean controls
            pageObj.shapes = [...evaluatedControls, ...nonControlShapes];
        }
    }

    return parsedPages;
}

/**
 * Renders a PDF page to an offscreen HTML5 canvas element and analyzes dark pixel ratios
 * within control bounding boxes to determine if checkboxes or radio options are checked.
 *
 * @async
 * @function evaluateControlsWithCanvas
 * @param {Object} pdfPage - PDF.js page proxy object.
 * @param {Array<Object>} controls - List of shape control objects to evaluate.
 * @param {number} [scale=2.0] - Scale factor used for rendering high-DPI canvas coordinates.
 * @returns {Promise<Array<Object>>} Controls with updated `is_checked` boolean properties.
 */
async function evaluateControlsWithCanvas(pdfPage, controls, scale = 2.0) {
    const viewport = pdfPage.getViewport({ scale: 1.0 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width * scale);
    canvas.height = Math.ceil(viewport.height * scale);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    await pdfPage.render({
        canvasContext: ctx,
        viewport: pdfPage.getViewport({ scale }),
    }).promise;

    return controls.map((control) => {
        const [x0, y0, x1, y1] = control.bbox;

        const pxLeft = Math.floor(x0 * scale);
        const pxTop = Math.floor(y0 * scale);
        const pxWidth = Math.ceil((x1 - x0) * scale);
        const pxHeight = Math.ceil((y1 - y0) * scale);

        const padX = Math.floor(pxWidth * 0.2);
        const padY = Math.floor(pxHeight * 0.2);
        const cropX = pxLeft + padX;
        const cropY = pxTop + padY;
        const cropW = Math.max(1, pxWidth - padX * 2);
        const cropH = Math.max(1, pxHeight - padY * 2);

        let darkPixels = 0;
        const totalPixels = cropW * cropH;

        try {
            const imageData = ctx.getImageData(cropX, cropY, cropW, cropH);
            const data = imageData.data;

            for (let i = 0; i < data.length; i += 4) {
                if (data[i + 3] > 0) {
                    // Check non-transparent pixels
                    const brightness = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
                    if (brightness < 180) darkPixels++;
                }
            }
        } catch (e) {
            console.warn("Pixel sampling out of bounds:", e);
        }

        const darkRatio = totalPixels > 0 ? darkPixels / totalPixels : 0;

        return {
            ...control,
            is_checked: darkRatio > 0.12,
        };
    });
}

/**
 * Global helper to check if a target phrase has an associated checked shape (checkbox/radio)
 * or contains inline text check symbols ([X], ☑, etc.).
 *
 * @function isOptionChecked
 * @param {string} targetPhrase - The label text to search for within text blocks.
 * @param {Array<Object>} [allBlocks=[]] - Flat list of all text blocks across all pages.
 * @param {Array<Object>} [allShapes=[]] - Flat list of all evaluated shapes (checkboxes/radios) across all pages.
 * @param {Array<number>|null} [bbox=null] - Optional bounding box filter `[x0, y0, x1, y1]` to constrain search area.
 * @returns {boolean} True if the option is evaluated as checked, otherwise false.
 */
function isOptionChecked(targetPhrase, allBlocks = [], allShapes = [], bbox = null) {
    const targetLower = targetPhrase.toLowerCase();

    if (bbox) {
        allBlocks = allBlocks.filter(
            (b) =>
                b.global_bbox[0] >= bbox[0] &&
                b.global_bbox[1] >= bbox[1] &&
                b.global_bbox[2] <= bbox[2] &&
                b.global_bbox[3] <= bbox[3],
        );
    }

    // Find all blocks containing the target phrase
    let matchingBlocks = allBlocks;
    if (allBlocks.length > 1) {
        matchingBlocks = allBlocks.filter((b) => b.text.toLowerCase().includes(targetLower));
    }

    for (const block of matchingBlocks) {
        const textBbox = block.bbox;

        // Use shapes attached to block or fall back to page shapes
        const candidateShapes =
            block.shapes && block.shapes.length > 0 ? block.shapes : allShapes.filter((s) => s.page === block.page);

        // Look for a shape aligned with this specific text line
        let foundAssociatedShape = false;

        for (const shape of candidateShapes) {
            if (shape.type !== "checkbox" && shape.type !== "radio") continue;

            const shapeBbox = shape.bbox;
            const verticalDiff = Math.abs(shapeBbox[1] - textBbox[1]);
            const horizontalDistance = textBbox[0] - shapeBbox[2];

            // Strict spatial alignment check (within 10px vertically)
            if (verticalDiff <= 5 && horizontalDistance >= -10 && horizontalDistance <= 20) {
                foundAssociatedShape = true;

                // Return the canvas evaluator's decision for this specific shape
                if (shape.is_checked) {
                    return true;
                }
            }
        }

        // Fallback: Only check block glyphs if NO shape was spatially matched nearby
        if (!foundAssociatedShape && block.has_check_symbol) {
            // Ensure the text line itself contains an explicit checked symbol, not just an unchecked box symbol
            if (/[\u2611\u2612\u2705\u2713\u2714]|\[x\]/i.test(block.text)) {
                return true;
            }
        }
    }

    return false;
}

// Render Debug Visualizer SVG Overlay
if (typeof renderParsedPdfSvg !== "function" && document.getElementById('pdf-view')) {
    document.getElementById('pdf-view').style.display = 'none';
}