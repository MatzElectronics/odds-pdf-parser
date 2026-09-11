/**
 * Renders parsed PDF metadata overlayed directly on top of rendered PDF page images.
 *
 * @param {Array<Object>} parsedPages - Array of parsed page objects with shapes, text_blocks, page_height
 * @param {HTMLElement|string} container - Target DOM element or element ID
 * @param {PDFDocumentProxy} [pdfDoc=null] - Loaded PDF.js document object (for background rendering)
 * @param {Object} [options] - Configuration overrides
 */
async function renderParsedPdfSvg(parsedPages, container, pdfDoc = null, options = {}) {
    const target = typeof container === "string" ? document.getElementById(container) : container;
    if (!target) {
        console.error("Target container element not found.");
        return;
    }

    const config = {
        padding: options.padding || 20,
        backgroundColor: options.backgroundColor || "#1e1e24",
        showText: options.showText !== undefined ? options.showText : true,
        showCheckboxes: options.showCheckboxes !== undefined ? options.showCheckboxes : true,
        showImages: options.showImages !== undefined ? options.showImages : true,
        renderScale: options.renderScale || 2.0, // Scale for high-DPI background rendering
        strokeWidth: options.strokeWidth || 2.5,
        minScale: 0.2,
        maxScale: 10,
        ...options,
    };

    const palette = [
        "#FF5722",
        "#4CAF50",
        "#2196F3",
        "#E91E63",
        "#9C27B0",
        "#00BCD4",
        "#FFC107",
        "#8BC34A",
        "#3F51B5",
        "#FF9800",
    ];

    // 1. Calculate document dimensions & cumulative page Y-offsets
    let totalHeight = 0;
    let maxWidth = 0;
    const pageYOffsets = [];

    parsedPages.forEach((page) => {
        pageYOffsets.push(totalHeight);
        totalHeight += page.page_height;

        page.shapes.concat(page.text_blocks || []).forEach((item) => {
            const bbox = item.global_bbox || item.bbox;
            if (bbox && bbox[2] > maxWidth) maxWidth = bbox[2];
        });
    });

    maxWidth = maxWidth > 0 ? maxWidth + config.padding : 612;
    totalHeight = totalHeight > 0 ? totalHeight + config.padding : 792;

    // 2. Setup DOM Container
    target.innerHTML = "";
    target.style.position = "relative";
    target.style.overflow = "hidden";

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.style.backgroundColor = config.backgroundColor;
    svg.style.cursor = "grab";
    svg.style.userSelect = "none";

    // Root Viewport Group for Pan/Zoom
    const viewport = document.createElementNS(svgNS, "g");
    svg.appendChild(viewport);

    // Group 1: Background Images (Rendered Canvas Pages)
    const bgGroup = document.createElementNS(svgNS, "g");
    bgGroup.setAttribute("id", "pdf-background-layer");
    viewport.appendChild(bgGroup);

    // Group 2: SVG Vector Overlay Layer (Lines, BBoxes, Checkboxes)
    const overlayGroup = document.createElementNS(svgNS, "g");
    overlayGroup.setAttribute("id", "pdf-overlay-layer");
    viewport.appendChild(overlayGroup);

    // Pan / Zoom State
    let scale = 1;
    let pointX = 0;
    let pointY = 0;
    let isPanning = false;
    let startX = 0;
    let startY = 0;

    function updateTransform() {
        viewport.setAttribute("transform", `translate(${pointX}, ${pointY}) scale(${scale})`);
    }

    // --- PAN & ZOOM EVENT HANDLERS ---
    svg.addEventListener("wheel", (e) => {
        e.preventDefault();
        const rect = svg.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const zoomFactor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        const newScale = Math.min(Math.max(scale * zoomFactor, config.minScale), config.maxScale);

        if (newScale !== scale) {
            pointX = mouseX - (mouseX - pointX) * (newScale / scale);
            pointY = mouseY - (mouseY - pointY) * (newScale / scale);
            scale = newScale;
            updateTransform();
        }
    });

    svg.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        isPanning = true;
        startX = e.clientX - pointX;
        startY = e.clientY - pointY;
        svg.style.cursor = "grabbing";
    });

    window.addEventListener("mousemove", (e) => {
        if (!isPanning) return;
        pointX = e.clientX - startX;
        pointY = e.clientY - startY;
        updateTransform();
    });

    window.addEventListener("mouseup", () => {
        if (isPanning) {
            isPanning = false;
            svg.style.cursor = "grab";
        }
    });

    // --- TOOLTIP SETUP ---
    let tooltip = document.getElementById("svg-debug-tooltip");
    if (!tooltip) {
        tooltip = document.createElement("div");
        tooltip.id = "svg-debug-tooltip";
        tooltip.style.position = "fixed";
        tooltip.style.padding = "6px 10px";
        tooltip.style.background = "rgba(0,0,0,0.85)";
        tooltip.style.color = "#fff";
        tooltip.style.fontSize = "12px";
        tooltip.style.fontFamily = "monospace";
        tooltip.style.borderRadius = "4px";
        tooltip.style.pointerEvents = "none";
        tooltip.style.display = "none";
        tooltip.style.zIndex = "9999";
        document.body.appendChild(tooltip);
    }

    // --- 3. RENDER CANVASES & INJECT INTO BACKGROUND LAYER ---
    if (config.showImages && pdfDoc) {
        for (let i = 0; i < parsedPages.length; i++) {
            const pageNum = parsedPages[i].page_number || i + 1;
            const pageY = pageYOffsets[i];

            try {
                const page = await pdfDoc.getPage(pageNum);
                const viewport1x = page.getViewport({ scale: 1.0 });

                // Render to offscreen canvas
                const canvas = document.createElement("canvas");
                canvas.width = Math.ceil(viewport1x.width * config.renderScale);
                canvas.height = Math.ceil(viewport1x.height * config.renderScale);
                const ctx = canvas.getContext("2d");

                await page.render({
                    canvasContext: ctx,
                    viewport: page.getViewport({ scale: config.renderScale }),
                }).promise;

                // Convert canvas to Data URL
                const dataUrl = canvas.toDataURL("image/png");

                // Create SVG <image> underlay mapped to 1.0x PDF point coordinates
                const imgEl = document.createElementNS(svgNS, "image");
                imgEl.setAttributeNS("http://www.w3.org/1999/xlink", "href", dataUrl);
                imgEl.setAttribute("x", 0);
                imgEl.setAttribute("y", pageY);
                imgEl.setAttribute("width", viewport1x.width);
                imgEl.setAttribute("height", viewport1x.height);
                imgEl.style.opacity = options.bgOpacity !== undefined ? options.bgOpacity : 0.85;

                bgGroup.appendChild(imgEl);
            } catch (err) {
                console.warn(`Could not render PDF background for page ${pageNum}:`, err);
            }
        }
    }

    // --- 4. PAGE SEPARATORS ---
    pageYOffsets.forEach((y, idx) => {
        if (idx > 0) {
            const sep = document.createElementNS(svgNS, "line");
            sep.setAttribute("x1", 0);
            sep.setAttribute("y1", y);
            sep.setAttribute("x2", maxWidth);
            sep.setAttribute("y2", y);
            sep.setAttribute("stroke", "#ff4444");
            sep.setAttribute("stroke-width", "1");
            sep.setAttribute("stroke-dasharray", "4,4");
            overlayGroup.appendChild(sep);
        }
    });

    // --- 5. RENDER OVERLAY VECTOR SHAPES & TEXT ---
    let colorIdx = 0;

    parsedPages.forEach((page) => {
        // Text Bounding Boxes
        if (config.showText && page.text_blocks) {
            page.text_blocks.forEach((tb) => {
                const bbox = tb.global_bbox || tb.bbox;
                const rect = document.createElementNS(svgNS, "rect");
                rect.setAttribute("x", bbox[0]);
                rect.setAttribute("y", bbox[1]);
                rect.setAttribute("width", bbox[2] - bbox[0]);
                rect.setAttribute("height", bbox[3] - bbox[1]);
                rect.setAttribute("fill", "rgba(255, 255, 255, 0.05)");
                rect.setAttribute("stroke", "rgba(255, 255, 255, 0.3)");
                rect.setAttribute("stroke-width", "0.5");

                rect.addEventListener("mouseenter", () => {
                    tooltip.style.display = "block";
                    tooltip.innerText = `Text: "${tb.text.substring(0, 35)}${tb.text.length > 35 ? "..." : ""}"\nBBox: [${bbox.join(", ")}]`;
                });
                rect.addEventListener("mousemove", (e) => {
                    tooltip.style.left = e.clientX + 12 + "px";
                    tooltip.style.top = e.clientY + 12 + "px";
                });
                rect.addEventListener("mouseleave", () => (tooltip.style.display = "none"));

                overlayGroup.appendChild(rect);
            });
        }

        // Checkboxes & Radio Buttons
        if (config.showCheckboxes) {
            const controls = page.shapes.filter((s) => s.type === "checkbox" || s.type === "radio");
            controls.forEach((ctrl) => {
                const bbox = ctrl.global_bbox || ctrl.bbox;
                const width = bbox[2] - bbox[0];
                const height = bbox[3] - bbox[1];

                const box = document.createElementNS(svgNS, "rect");
                box.setAttribute("x", bbox[0]);
                box.setAttribute("y", bbox[1]);
                box.setAttribute("width", width);
                box.setAttribute("height", height);
                box.setAttribute("fill", ctrl.is_checked ? "rgba(0, 230, 118, 0.35)" : "rgba(255, 23, 68, 0.15)");
                box.setAttribute("stroke", ctrl.is_checked ? "#00e676" : "#ff1744");
                box.setAttribute("stroke-width", "2");
                box.setAttribute("rx", ctrl.type === "radio" ? width / 2 : "2");

                box.addEventListener("mouseenter", () => {
                    tooltip.style.display = "block";
                    tooltip.innerText = `[${ctrl.type.toUpperCase()}] Checked: ${ctrl.is_checked}\nDark Ratio: ${(ctrl.dark_pixel_ratio * 100 || 0).toFixed(1)}%\nBBox: [${bbox.join(", ")}]`;
                });
                box.addEventListener("mousemove", (e) => {
                    tooltip.style.left = e.clientX + 12 + "px";
                    tooltip.style.top = e.clientY + 12 + "px";
                });
                box.addEventListener("mouseleave", () => (tooltip.style.display = "none"));

                overlayGroup.appendChild(box);
            });
        }

        // Merged Table Lines
        const lines = page.shapes.filter((s) => s.type === "h_line" || s.type === "v_line");
        lines.forEach((line) => {
            const lineEl = document.createElementNS(svgNS, "line");
            const color = palette[colorIdx % palette.length];
            colorIdx++;

            let x1, y1, x2, y2, details;

            if (line.type === "h_line") {
                x1 = line.x0;
                x2 = line.x1;
                y1 = line.global_y ?? line.y0;
                y2 = line.global_y ?? line.y0;
                details = `H-Line: Y=${y1}\nX: ${x1} → ${x2} (Len: ${Math.round(x2 - x1)}pt)`;
            } else {
                x1 = line.global_x ?? line.x0;
                x2 = line.global_x ?? line.x0;
                y1 = line.global_y0 ?? line.y0;
                y2 = line.global_y1 ?? line.y1;
                details = `V-Line: X=${x1}\nY: ${y1} → ${y2} (Len: ${Math.round(y2 - y1)}pt)`;
            }

            lineEl.setAttribute("x1", x1);
            lineEl.setAttribute("y1", y1);
            lineEl.setAttribute("x2", x2);
            lineEl.setAttribute("y2", y2);
            lineEl.setAttribute("stroke", color);
            lineEl.setAttribute("stroke-width", config.strokeWidth);
            lineEl.setAttribute("stroke-linecap", "round");
            lineEl.style.cursor = "pointer";

            lineEl.addEventListener("mouseenter", () => {
                lineEl.setAttribute("stroke-width", config.strokeWidth * 2);
                tooltip.style.display = "block";
                tooltip.innerText = details;
            });
            lineEl.addEventListener("mousemove", (e) => {
                tooltip.style.left = e.clientX + 12 + "px";
                tooltip.style.top = e.clientY + 12 + "px";
            });
            lineEl.addEventListener("mouseleave", () => {
                lineEl.setAttribute("stroke-width", config.strokeWidth);
                tooltip.style.display = "none";
            });

            overlayGroup.appendChild(lineEl);
        });
    });

    // --- 6. FLOATING CONTROLS UI ---
    const controlsDiv = document.createElement("div");
    controlsDiv.style.position = "absolute";
    controlsDiv.style.top = "12px";
    controlsDiv.style.right = "12px";
    controlsDiv.style.display = "flex";
    controlsDiv.style.gap = "6px";
    controlsDiv.style.zIndex = "10";

    const btnStyle = `
    background: #2a2a32;
    color: #fff;
    border: 1px solid #444;
    border-radius: 4px;
    padding: 6px 10px;
    font-size: 12px;
    font-family: monospace;
    cursor: pointer;
    user-select: none;
  `;

    const resetZoom = () => {
        const containerWidth = target.clientWidth || 800;
        scale = Math.min(containerWidth / maxWidth, 1);
        pointX = (containerWidth - maxWidth * scale) / 2;
        pointY = 20;
        updateTransform();
    };

    const btnZoomIn = document.createElement("button");
    btnZoomIn.innerText = "+";
    btnZoomIn.style.cssText = btnStyle;
    btnZoomIn.onclick = () => {
        scale = Math.min(scale * 1.2, config.maxScale);
        updateTransform();
    };

    const btnZoomOut = document.createElement("button");
    btnZoomOut.innerText = "-";
    btnZoomOut.style.cssText = btnStyle;
    btnZoomOut.onclick = () => {
        scale = Math.max(scale / 1.2, config.minScale);
        updateTransform();
    };

    const btnReset = document.createElement("button");
    btnReset.innerText = "Reset View";
    btnReset.style.cssText = btnStyle;
    btnReset.onclick = resetZoom;

    controlsDiv.appendChild(btnZoomIn);
    controlsDiv.appendChild(btnZoomOut);
    controlsDiv.appendChild(btnReset);

    target.appendChild(controlsDiv);
    target.appendChild(svg);

    // Initial fit
    resetZoom();
}
