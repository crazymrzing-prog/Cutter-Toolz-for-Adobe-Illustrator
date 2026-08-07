// ============================================================================
// Quik Cutz - Adobe Illustrator ExtendScript (.jsx)
// Ported from the Quik Cutz Inkscape 1.x extension (quik_cutz_grid.py/.inx)
// and the CorelDRAW VBA macro (QuikCutzGrid.bas) - all three implement the
// same tool.
//
// Starts from a single sticker (an axis-aligned rectangle path, usually
// with artwork placed on top and selected alongside it) and tiles it into a
// grid sized to fill a target width x height (mm) - the column/row counts
// are worked out automatically from the cut shape's own size. It draws
// every horizontal and vertical boundary line of that grid - including the
// sheet's own outer edges, not just the internal dividers - as two
// alternating snake paths: one set of horizontal cuts, one set of vertical
// cuts. For N copies along an axis there are N+1 lines on that axis.
//
// HOW TO INSTALL / RUN:
//   Illustrator has no macro "project" concept like CorelDRAW's .gms -
//   scripts are just .jsx files run directly.
//   1. Save this file anywhere (e.g. next to your other Illustrator
//      scripts, or Illustrator's own Scripts folder so it shows up under
//      File > Scripts).
//   2. Select the cut rectangle (plus any artwork you want repeated) in
//      Illustrator.
//   3. File > Scripts > Other Script... > browse to this .jsx and open it.
//      (Or, if placed in Illustrator's Scripts folder before Illustrator
//      was started, it appears directly under File > Scripts > QuikCutz.)
//
// NOTES ON THIS PORT:
//   - Illustrator has no distinct "native rectangle" object type the way
//     CorelDRAW does - a rectangle drawn with the Rectangle tool is just a
//     4-point closed PathItem once created. So the cut shape is identified
//     geometrically instead: a closed path with exactly 4 anchor points,
//     all straight corners (no curve handles), forming an axis-aligned
//     rectangle. A Live Rectangle with rounded corners will NOT match this
//     check (by design - a filleted corner there isn't a clean cut line).
//   - Units: the dialog always asks for millimeters regardless of your
//     document's ruler unit setting, since Illustrator's scripting DOM
//     always works in points internally (72pt = 1in = 25.4mm) no matter
//     what the ruler displays. Conversion happens once, at the point each
//     mm value is read from the dialog.
//   - Coordinate system: Illustrator's geometricBounds/translate() use the
//     same "Y increases upward" convention as CorelDRAW's real coordinate
//     space, so the same synthetic-space trick from the other two ports
//     carries over unchanged: all grid math happens in a top-down
//     (Inkscape/SVG-style) synthetic space, then a single flip
//     (yReal = 2*origTop - ySynthetic) converts to real Illustrator
//     coordinates only at the point each path is actually built.
//   - Illustrator's PathItem can only ever be ONE continuous subpath -
//     unlike CorelDRAW's Curve object, it can't hold several disconnected
//     subpaths as one shape. So where the CorelDRAW port bundled multiple
//     unjoined lines into a single multi-subpath Shape purely to have one
//     object, this port instead creates one separate PathItem per line (or
//     per already-merged run, when connectors are on) and groups them all
//     together - functionally identical for cutting purposes.
//   - Rounded corners at connector joints are drawn as smooth Bezier
//     curves that are exactly tangent to both lines at the join (a very
//     close, standard fillet approximation, not a mathematically perfect
//     circular arc at extreme angles) - same technique as the other ports.
//   - This was written and checked carefully against Adobe's documented
//     ExtendScript object model, but not run inside Illustrator itself.
//     If a specific line throws an error, note the exact message and
//     which step of the dialog/run you were on - it's very likely a
//     small, isolated fix.
// ============================================================================

#target illustrator

(function () {

var MM_TO_PT = 72.0 / 25.4;
function mm(v) { return v * MM_TO_PT; }

// ============================ Geometry (synthetic, top-down space) ========
// All functions in this section work in the SAME top-down convention as the
// original Inkscape/SVG script (numerically smaller y = "top"). Real
// Illustrator coordinates are only produced later, via buildRealPointSpecs /
// emitOuterBoxShape / emitBracketShape, using the flip
// yReal = 2*origTop - ySynthetic.

function extendLine(x1, y1, x2, y2, ext) {
    if (ext <= 0) return [x1, y1, x2, y2];
    var d;
    if (Math.abs(x2 - x1) >= Math.abs(y2 - y1)) {
        d = (x2 > x1) ? 1 : -1;
        return [x1 - d * ext, y1, x2 + d * ext, y2];
    } else {
        d = (y2 > y1) ? 1 : -1;
        return [x1, y1 - d * ext, x2, y2 + d * ext];
    }
}

function buildHorizontalLines(gridLeft, gridTop, totalW, totalH, rows, startTop, startLeft) {
    // One entry per row boundary (rows+1 of them), including the sheet's
    // own top and bottom edges, alternating direction each step.
    var lines = [];
    for (var i = 0; i <= rows; i++) {
        var rowIdx = startTop ? i : (rows - i);
        var y = gridTop + rowIdx * (totalH / rows);
        var goLTR = ((i % 2) === 0) ? startLeft : !startLeft;
        if (goLTR) {
            lines.push({x1: gridLeft, y1: y, x2: gridLeft + totalW, y2: y});
        } else {
            lines.push({x1: gridLeft + totalW, y1: y, x2: gridLeft, y2: y});
        }
    }
    return lines;
}

function buildVerticalLines(gridLeft, gridTop, totalW, totalH, cols, startLeft, startBottom) {
    // One entry per column boundary (cols+1 of them), including the sheet's
    // own left and right edges, alternating direction each step.
    var lines = [];
    for (var i = 0; i <= cols; i++) {
        var colIdx = startLeft ? i : (cols - i);
        var x = gridLeft + colIdx * (totalW / cols);
        var goUp = ((i % 2) === 0) ? startBottom : !startBottom;
        if (goUp) {
            lines.push({x1: x, y1: gridTop + totalH, x2: x, y2: gridTop});
        } else {
            lines.push({x1: x, y1: gridTop, x2: x, y2: gridTop + totalH});
        }
    }
    return lines;
}

// ---- Subpath entries -------------------------------------------------------
// A subpath entry is a plain object: {points: [[x,y], ...], flags: [bool, ...]}
// flags.length === points.length - 1, one entry per segment, True where that
// segment is an implicit connector between two lines rather than a true cut
// line. This explicit per-segment flag (rather than assuming connectors fall
// on every other index) is what lets subpaths be safely spliced together,
// e.g. by joinHVBracket below - mirrors quik_cutz_grid.py's is_connector list
// exactly, and the flags-array approach already used in the CorelDRAW port.

function buildSubpaths(lines, extLen, useExt, useConn) {
    var result = [];
    var points = null, flags = null;

    for (var i = 0; i < lines.length; i++) {
        var e;
        if (useExt) {
            e = extendLine(lines[i].x1, lines[i].y1, lines[i].x2, lines[i].y2, extLen);
        } else {
            e = [lines[i].x1, lines[i].y1, lines[i].x2, lines[i].y2];
        }

        if (i === 0 || !useConn) {
            if (points !== null) result.push({points: points, flags: flags});
            points = [[e[0], e[1]], [e[2], e[3]]];
            flags = [false];   // this line segment is a true cut line
        } else {
            flags.push(true);          // connector segment (previous line's end -> this line's start)
            points.push([e[0], e[1]]);
            flags.push(false);         // this line segment is a true cut line
            points.push([e[2], e[3]]);
        }
    }
    if (points !== null) result.push({points: points, flags: flags});

    return result;
}

function pointsEqual(a, b) {
    return a[0] === b[0] && a[1] === b[1];
}

function joinHVBracket(subH, subV) {
    // Joins path one's subpath entry to path two's subpath entry into one
    // combined entry. See the CorelDRAW port's JoinHVBracket for the full
    // rationale - short version: if extended stub tips don't already
    // coincide, one extra bend point (hLast.x, vFirst.y) is inserted so the
    // join is two orthogonal segments (a small right-angle bracket) rather
    // than a diagonal shortcut. Returns 0-based squareIdx (point indices
    // that must stay sharp, matching quik_cutz_grid.py's square_indices).
    var hPoints = subH.points, hFlags = subH.flags;
    var vPoints = subV.points, vFlags = subV.flags;
    var hLast = hPoints[hPoints.length - 1];
    var vFirst = vPoints[0];
    var nH = hPoints.length;

    var outPoints = [];
    var outFlags = [];
    var squareIdx = [];
    var i;

    if (pointsEqual(hLast, vFirst)) {
        for (i = 0; i < hPoints.length; i++) outPoints.push(hPoints[i]);
        for (i = 1; i < vPoints.length; i++) outPoints.push(vPoints[i]);
        for (i = 0; i < hFlags.length; i++) outFlags.push(hFlags[i]);
        for (i = 0; i < vFlags.length; i++) outFlags.push(vFlags[i]);
        squareIdx.push(nH - 1);
    } else {
        var bendX = hLast[0], bendY = vFirst[1];

        for (i = 0; i < hPoints.length; i++) outPoints.push(hPoints[i]);
        outPoints.push([bendX, bendY]);
        for (i = 0; i < vPoints.length; i++) outPoints.push(vPoints[i]);

        for (i = 0; i < hFlags.length; i++) outFlags.push(hFlags[i]);
        outFlags.push(true);
        outFlags.push(true);
        for (i = 0; i < vFlags.length; i++) outFlags.push(vFlags[i]);

        squareIdx.push(nH - 1);
        squareIdx.push(nH);
        squareIdx.push(nH + 1);
    }

    return {points: outPoints, flags: outFlags, squareIdx: squareIdx};
}

// ============================ Real-space drawing ============================

function distD(x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
}

function normalizeVec(vx, vy) {
    var d = Math.sqrt(vx * vx + vy * vy);
    if (d === 0) return [0, 0];
    return [vx / d, vy / d];
}

function isSquareIndex(idx, squareIdx) {
    if (!squareIdx) return false;
    for (var i = 0; i < squareIdx.length; i++) {
        if (squareIdx[i] === idx) return true;
    }
    return false;
}

// Converts one synthetic-space subpath entry into a list of real-coordinate
// "point specs" ready to feed into an Illustrator PathItem's pathPoints:
//   {anchor:[x,y]}                      - plain sharp corner / endpoint
//   {anchor:[x,y], rightDir:[x,y]}      - start of a filleted curve segment
//   {anchor:[x,y], leftDir:[x,y]}       - end of a filleted curve segment
// squareIdx (optional array, or null) lists 0-based point indices that stay
// sharp regardless of radius - used for the H-to-V join's bracket corners.
// Mirrors points_to_dpath in quik_cutz_grid.py / AddFilletedSubpath in the
// CorelDRAW port.
function buildRealPointSpecs(subEntry, origTop, radius, extLen, squareIdx) {
    var synPts = subEntry.points;
    var flags = subEntry.flags;
    var n = synPts.length;

    var px = [], py = [];
    var k;
    for (k = 0; k < n; k++) {
        px.push(synPts[k][0]);
        py.push(2 * origTop - synPts[k][1]);
    }

    var specs = [];
    specs.push({anchor: [px[0], py[0]]});

    if (radius <= 0 || n < 3) {
        for (k = 1; k < n; k++) specs.push({anchor: [px[k], py[k]]});
        return specs;
    }

    for (var i = 1; i <= n - 2; i++) {   // 0-based corner index, matches python's range(1, n-1)
        if (isSquareIndex(i, squareIdx)) {
            specs.push({anchor: [px[i], py[i]]});
            continue;
        }

        var din = normalizeVec(px[i] - px[i - 1], py[i] - py[i - 1]);
        var dout = normalizeVec(px[i + 1] - px[i], py[i + 1] - py[i]);
        var crossZ = din[0] * dout[1] - din[1] * dout[0];

        if (Math.abs(crossZ) < 1e-9) {
            // collinear / straight reversal - no clean fillet, keep it sharp
            specs.push({anchor: [px[i], py[i]]});
            continue;
        }

        // flags[k] (0-based, k = 0..n-2) tells whether the segment from
        // point k to point k+1 is a connector. The segment BEFORE corner i
        // is flags[i-1]; the segment AFTER corner i is flags[i].
        var segBeforeConn = !!flags[i - 1];
        var segAfterConn = !!flags[i];

        var limitBefore = segBeforeConn ? (distD(px[i - 1], py[i - 1], px[i], py[i]) / 2) : extLen;
        var limitAfter = segAfterConn ? (distD(px[i], py[i], px[i + 1], py[i + 1]) / 2) : extLen;

        var r = radius;
        if (limitBefore < r) r = limitBefore;
        if (limitAfter < r) r = limitAfter;

        if (r <= 0) {
            specs.push({anchor: [px[i], py[i]]});
            continue;
        }

        var p1x = px[i] - r * din[0], p1y = py[i] - r * din[1];
        var p2x = px[i] + r * dout[0], p2y = py[i] + r * dout[1];

        // Quadratic-to-cubic elevation: using the true corner as the
        // quadratic control point guarantees exact tangency at p1/p2 (a
        // very close, standard fillet approximation).
        var c1x = p1x + (2 / 3) * (px[i] - p1x);
        var c1y = p1y + (2 / 3) * (py[i] - p1y);
        var c2x = p2x + (2 / 3) * (px[i] - p2x);
        var c2y = p2y + (2 / 3) * (py[i] - p2y);

        specs.push({anchor: [p1x, p1y], rightDir: [c1x, c1y]});
        specs.push({anchor: [p2x, p2y], leftDir: [c2x, c2y]});
    }

    specs.push({anchor: [px[n - 1], py[n - 1]]});
    return specs;
}

function addPathPointsFromSpecs(pathItem, specs) {
    for (var i = 0; i < specs.length; i++) {
        var s = specs[i];
        var pp = pathItem.pathPoints.add();
        pp.anchor = s.anchor;
        pp.leftDirection = s.leftDir ? s.leftDir : s.anchor;
        pp.rightDirection = s.rightDir ? s.rightDir : s.anchor;
        pp.pointType = PointType.CORNER;
    }
}

function emitPathFromSubEntry(subEntry, origTop, radius, extLen, squareIdx) {
    var specs = buildRealPointSpecs(subEntry, origTop, radius, extLen, squareIdx);
    var pathItem = app.activeDocument.pathItems.add();
    addPathPointsFromSpecs(pathItem, specs);
    pathItem.closed = false;
    return pathItem;
}

function emitPathsFromSubpaths(subpaths, origTop, radius, extLen, squareIdx) {
    var result = [];
    for (var i = 0; i < subpaths.length; i++) {
        result.push(emitPathFromSubEntry(subpaths[i], origTop, radius, extLen, squareIdx));
    }
    return result;
}

function emitEachSubpathAsShape(subpaths, origTop, radius, extLen, color, swVal, labelName, collectInto) {
    for (var i = 0; i < subpaths.length; i++) {
        var shp = emitPathFromSubEntry(subpaths[i], origTop, radius, extLen, null);
        shp.filled = false;
        shp.stroked = true;
        shp.strokeColor = color;
        shp.strokeWidth = swVal;
        try { shp.name = labelName; } catch (e) {}
        if (collectInto) collectInto.push(shp);
    }
}

function emitOuterBoxShape(gridLeft, gridTopSyn, totalW, totalH, extLen, addExt, origTop) {
    var o = addExt ? extLen : 0;
    var sx = [gridLeft - o, gridLeft + totalW + o, gridLeft + totalW + o, gridLeft - o];
    var sy = [gridTopSyn - o, gridTopSyn - o, gridTopSyn + totalH + o, gridTopSyn + totalH + o];

    var real = [];
    for (var i = 0; i < 4; i++) real.push([sx[i], 2 * origTop - sy[i]]);

    var pathItem = app.activeDocument.pathItems.add();
    pathItem.setEntirePath(real);
    pathItem.closed = true;
    return pathItem;
}

function emitBracketShape(hLastX, hLastY, vFirstX, vFirstY, origTop) {
    // Test-mode-only helper: draws the plain, always-sharp 3-point H-to-V
    // bracket as its own separate green shape. In normal (non-test) mode
    // the same bracket geometry is instead spliced directly into the
    // combined path by joinHVBracket - this is only for the demo-mode
    // green preview line.
    var bendX = hLastX, bendY = vFirstY;
    var real = [
        [hLastX, 2 * origTop - hLastY],
        [bendX, 2 * origTop - bendY],
        [vFirstX, 2 * origTop - vFirstY]
    ];
    var pathItem = app.activeDocument.pathItems.add();
    pathItem.setEntirePath(real);
    pathItem.closed = false;
    return pathItem;
}

function applyNormalStyle(pathItem, styleSource, labelName) {
    pathItem.filled = false;
    pathItem.stroked = true;
    try {
        pathItem.strokeColor = styleSource.strokeColor;
        pathItem.strokeWidth = styleSource.strokeWidth;
    } catch (e) {}
    try { pathItem.name = labelName; } catch (e) {}
}

function makeRGB(r, g, b) {
    var c = new RGBColor();
    c.red = r; c.green = g; c.blue = b;
    return c;
}

function groupShapesAs(shapesArr, groupName) {
    // Groups every shape gathered in shapesArr into a single group named
    // groupName. No-ops on an empty collection; a single-shape collection
    // is just renamed directly rather than wrapped in a group of one.
    if (!shapesArr || shapesArr.length === 0) return;

    if (shapesArr.length === 1) {
        try { shapesArr[0].name = groupName; } catch (e) {}
        return;
    }

    var grp = app.activeDocument.groupItems.add();
    for (var i = 0; i < shapesArr.length; i++) {
        shapesArr[i].moveToEnd(grp);
    }
    try { grp.name = groupName; } catch (e) {}
}

function duplicateAndOffset(item, dx, dy) {
    var dup = item.duplicate();
    dup.translate(dx, dy);
    return dup;
}

// ============================ Rectangle detection ===========================

function uniqueSorted(arr) {
    var seen = {};
    var out = [];
    for (var i = 0; i < arr.length; i++) {
        var key = arr[i].toFixed(6);
        if (!seen[key]) { seen[key] = true; out.push(arr[i]); }
    }
    return out;
}

function isAxisAlignedRectangle(item) {
    // Illustrator has no distinct "Rectangle" object type once drawn - a
    // rectangle is just a closed 4-point PathItem. Detected geometrically:
    // closed, exactly 4 anchors, every corner a straight corner (handles
    // collapsed onto the anchor - no curve), and exactly 2 distinct X
    // values / 2 distinct Y values among the 4 anchors (which, combined
    // with 4 straight corners on a closed path, guarantees an
    // axis-aligned rectangle).
    if (item.typename !== "PathItem") return false;
    if (!item.closed) return false;

    var pts = item.pathPoints;
    if (pts.length !== 4) return false;

    var xs = [], ys = [];
    for (var i = 0; i < 4; i++) {
        var p = pts[i];
        if (!pointsEqual(p.leftDirection, p.anchor)) return false;
        if (!pointsEqual(p.rightDirection, p.anchor)) return false;
        xs.push(p.anchor[0]);
        ys.push(p.anchor[1]);
    }

    var uxs = uniqueSorted(xs);
    var uys = uniqueSorted(ys);
    if (uxs.length !== 2 || uys.length !== 2) return false;

    return true;
}

// ============================ Main entry =====================================

function runQuikCutz() {
    if (app.documents.length === 0) {
        alert("Open a document first.");
        return;
    }

    var doc = app.activeDocument;
    var sel = doc.selection;
    if (!sel || sel.length === 0) {
        alert("Select the cut rectangle (and, optionally, any artwork you want repeated with it).");
        return;
    }

    var cutShape = null;
    var rectCount = 0;
    var i;
    for (i = 0; i < sel.length; i++) {
        if (isAxisAlignedRectangle(sel[i])) {
            rectCount++;
            cutShape = sel[i];
        }
    }

    if (rectCount === 0) {
        alert("No rectangle found in the selection. The cut shape must be a closed, axis-aligned 4-point path (no rounded/curved corners) - select one (plus any artwork/text to go with it) and try again.");
        return;
    } else if (rectCount > 1) {
        alert("Select only ONE rectangle as the cut line (plus any artwork/text to go with it).");
        return;
    }

    var contentShapes = [];
    for (i = 0; i < sel.length; i++) {
        if (sel[i] !== cutShape) contentShapes.push(sel[i]);
    }

    var p = showQuikCutzDialog();
    if (!p) return;   // user cancelled

    if (p.fillWidthMM <= 0 || p.fillHeightMM <= 0) {
        alert("Fill Area width/height must be greater than 0.");
        return;
    }

    var gb = cutShape.geometricBounds;   // [left, top, right, bottom], Y increases upward
    var origLeft = gb[0], origTop = gb[1], origRight = gb[2], origBottom = gb[3];
    var w = origRight - origLeft;
    var h = origTop - origBottom;
    if (w <= 0 || h <= 0) {
        alert("Selected cut shape has zero width or height.");
        return;
    }

    var fillWidthPt = mm(p.fillWidthMM);
    var fillHeightPt = mm(p.fillHeightMM);

    // Columns/rows are always derived from the target fill area - there's
    // no separate "type the counts in directly" mode.
    var copiesWide = Math.floor(fillWidthPt / w);
    var copiesHigh = Math.floor(fillHeightPt / h);
    if (copiesWide < 1 || copiesHigh < 1) {
        alert("Fill Area is too small to fit even one copy of the cut shape. Increase the fill size or shrink the cut shape.");
        return;
    }

    // A single 5-way choice (p.layoutOption, "opt1".."opt5") drives
    // everything below:
    //   opt1 - no stub extensions, no join, no border
    //   opt2 - stub extensions only, ends left unjoined
    //   opt3 - stub extensions + join with connectors
    //   opt4 - stub extensions + connectors + join path one to path two
    //          with a square right-angle corner (needs both paths already
    //          single continuous subpaths, so it implies connectors are on)
    //   opt5 - stub extensions + border frame around the array
    var addExt = (p.layoutOption !== "opt1");
    var joinHV = (p.layoutOption === "opt4");
    var addConn = (p.layoutOption === "opt3" || p.layoutOption === "opt4");
    var addBox = (p.layoutOption === "opt5");
    var testMode = p.testMode;
    var extLen = mm(p.extensionLength);

    // The grid always builds right and down from the original sticker,
    // which sits at the top-left cell - the one corner that never moves as
    // copies are added.
    var colOfOrig = 0, rowOfOrig = 0;
    var anchorXLeft = true, anchorYTop = true;

    var gridLeft = origLeft - colOfOrig * w;
    // origTop doubles as the real Illustrator top-Y of the original
    // rectangle AND as the "synthetic" (top-down) top reference used by
    // all the grid math below - see the header notes for why this works.
    var gridTopSyn = origTop - rowOfOrig * h;

    var totalW = copiesWide * w;
    var totalH = copiesHigh * h;

    var cutShapesArr = [];
    var imageShapesArr = [];
    var cutCounter = 0;
    var imageCounter = 0;

    // ---- duplicate artwork into every cell ----
    // When Keep Originals is ON, every cell (including the original's own)
    // gets a fresh duplicate. When OFF (default), the original's own cell
    // is skipped here - the original artwork is folded into the Images
    // group afterward instead of being duplicated a second time.
    if (contentShapes.length > 0) {
        for (var col = 0; col < copiesWide; col++) {
            for (var row = 0; row < copiesHigh; row++) {
                if (p.keepOriginals || !(col === colOfOrig && row === rowOfOrig)) {
                    var dxReal = (gridLeft + col * w) - origLeft;
                    var dyReal = -((gridTopSyn + row * h) - origTop);
                    for (var ci = 0; ci < contentShapes.length; ci++) {
                        var dup = duplicateAndOffset(contentShapes[ci], dxReal, dyReal);
                        imageCounter++;
                        try { dup.name = "Image_" + imageCounter; } catch (e) {}
                        imageShapesArr.push(dup);
                    }
                }
            }
        }
    }

    var linesH = buildHorizontalLines(gridLeft, gridTopSyn, totalW, totalH, copiesHigh, anchorYTop, anchorXLeft);

    var linesV;
    if (addConn) {
        var lastRowLTR = ((copiesHigh % 2) === 0) ? anchorXLeft : !anchorXLeft;
        var hEndLeft = !lastRowLTR;
        var hEndBottom = anchorYTop;
        linesV = buildVerticalLines(gridLeft, gridTopSyn, totalW, totalH, copiesWide, hEndLeft, hEndBottom);
    } else {
        linesV = buildVerticalLines(gridLeft, gridTopSyn, totalW, totalH, copiesWide, anchorXLeft, !anchorYTop);
    }

    var swVal = Math.max(mm(0.2), Math.min(w, h) * 0.01);

    var radius = 0;
    if (addConn && addExt) radius = 0.9 * extLen;

    var subH = buildSubpaths(linesH, extLen, addExt, addConn);
    var subV = buildSubpaths(linesV, extLen, addExt, addConn);

    if (testMode) {
        emitEachSubpathAsShape(subH, origTop, radius, extLen, makeRGB(255, 0, 0), swVal, "Quik Cutz TEST - path one (red)", cutShapesArr);
        emitEachSubpathAsShape(subV, origTop, radius, extLen, makeRGB(0, 0, 255), swVal, "Quik Cutz TEST - path two (blue)", cutShapesArr);

        if (joinHV && subH.length > 0 && subV.length > 0) {
            var hPts0 = subH[0].points, vPts0 = subV[0].points;
            var hLast = hPts0[hPts0.length - 1], vFirst = vPts0[0];
            if (hLast[0] !== vFirst[0] || hLast[1] !== vFirst[1]) {
                var bracketShp = emitBracketShape(hLast[0], hLast[1], vFirst[0], vFirst[1], origTop);
                bracketShp.filled = false;
                bracketShp.stroked = true;
                bracketShp.strokeColor = makeRGB(0, 200, 0);
                bracketShp.strokeWidth = swVal;
                try { bracketShp.name = "Quik Cutz TEST - H-to-V bracket join (green)"; } catch (e) {}
                cutShapesArr.push(bracketShp);
            }
        }

        if (addBox) {
            var boxShpT = emitOuterBoxShape(gridLeft, gridTopSyn, totalW, totalH, extLen, addExt, origTop);
            boxShpT.filled = false;
            boxShpT.stroked = true;
            boxShpT.strokeColor = makeRGB(0, 200, 0);
            boxShpT.strokeWidth = swVal;
            try { boxShpT.name = "Quik Cutz TEST - outer box (green)"; } catch (e) {}
            cutShapesArr.push(boxShpT);
        }
    } else {
        if (joinHV && subH.length > 0 && subV.length > 0) {
            var joined = joinHVBracket(subH[0], subV[0]);
            var joinedEntry = {points: joined.points, flags: joined.flags};
            var joinedShp = emitPathFromSubEntry(joinedEntry, origTop, radius, extLen, joined.squareIdx);
            cutCounter++;
            applyNormalStyle(joinedShp, cutShape, "QuikCutz_" + cutCounter);
            cutShapesArr.push(joinedShp);
        } else {
            var hi, vi;
            if (subH.length > 0) {
                var hShps = emitPathsFromSubpaths(subH, origTop, radius, extLen, null);
                for (hi = 0; hi < hShps.length; hi++) {
                    cutCounter++;
                    applyNormalStyle(hShps[hi], cutShape, "QuikCutz_" + cutCounter);
                    cutShapesArr.push(hShps[hi]);
                }
            }
            if (subV.length > 0) {
                var vShps = emitPathsFromSubpaths(subV, origTop, radius, extLen, null);
                for (vi = 0; vi < vShps.length; vi++) {
                    cutCounter++;
                    applyNormalStyle(vShps[vi], cutShape, "QuikCutz_" + cutCounter);
                    cutShapesArr.push(vShps[vi]);
                }
            }
        }

        if (addBox) {
            var boxShp = emitOuterBoxShape(gridLeft, gridTopSyn, totalW, totalH, extLen, addExt, origTop);
            cutCounter++;
            applyNormalStyle(boxShp, cutShape, "QuikCutz_" + cutCounter);
            cutShapesArr.push(boxShp);
        }
    }

    if (!p.keepOriginals) {
        // Consume the original cut shape into the result...
        cutShape.remove();
        // ...and fold the original artwork (which served as the
        // original's cell above, and was never duplicated for that slot)
        // into the Images group alongside its duplicates. No repositioning
        // needed - it's already sitting exactly at the original's cell.
        if (contentShapes.length > 0) {
            for (var cj = 0; cj < contentShapes.length; cj++) {
                imageCounter++;
                try { contentShapes[cj].name = "Image_" + imageCounter; } catch (e) {}
                imageShapesArr.push(contentShapes[cj]);
            }
        }
    }
    // If Keep Originals is ON, the cut shape and every originally selected
    // artwork node are left exactly where they were - the newly generated
    // QuikCutz / Images groups are entirely separate.

    groupShapesAs(cutShapesArr, "QuikCutz");
    groupShapesAs(imageShapesArr, "Images");
}

// ============================ Dialog (ScriptUI) ==============================

function showQuikCutzDialog() {
    var win = new Window("dialog", "Quik Cutz");
    win.orientation = "column";
    win.alignChildren = "fill";

    var tabs = win.add("tabbedpanel");
    tabs.alignChildren = "fill";
    tabs.preferredSize = [430, 380];

    // ---- Options tab ----
    var tabOptions = tabs.add("tab", undefined, "Options");
    tabOptions.orientation = "column";
    tabOptions.alignChildren = "left";
    tabOptions.margins = 12;
    tabOptions.spacing = 8;

    var gW = tabOptions.add("group");
    gW.add("statictext", undefined, "Fill area width (mm):");
    var etW = gW.add("edittext", undefined, "100");
    etW.characters = 8;

    var gH = tabOptions.add("group");
    gH.add("statictext", undefined, "Fill area height (mm):");
    var etH = gH.add("edittext", undefined, "100");
    etH.characters = 8;

    var fraLayout = tabOptions.add("panel", undefined, "Stub / Join Options (choose one)");
    fraLayout.orientation = "column";
    fraLayout.alignChildren = "left";
    fraLayout.margins = 10;
    fraLayout.spacing = 4;

    var rb1 = fraLayout.add("radiobutton", undefined, "1. No stub extensions");
    var rb2 = fraLayout.add("radiobutton", undefined, "2. Add stub extensions only");
    var rb3 = fraLayout.add("radiobutton", undefined, "3. Add stubs + join with connectors");
    var rb4 = fraLayout.add("radiobutton", undefined, "4. Add stubs + connectors + join path one to path two (right-angle corner)");
    var rb5 = fraLayout.add("radiobutton", undefined, "5. Add stubs + border frame around grid and stubs");
    rb1.value = true;

    var gExt = tabOptions.add("group");
    gExt.add("statictext", undefined, "Stub length (mm):");
    var etExt = gExt.add("edittext", undefined, "5");
    etExt.characters = 8;

    var ckKeep = tabOptions.add("checkbox", undefined, "Keep original object(s) untouched");
    var ckTest = tabOptions.add("checkbox", undefined, "Demo mode (path one=red, path two=blue, box/join=green - nothing is deleted)");

    // ---- Help tabs ----
    // Read-only in intent (informational reference, not read back by OK) -
    // still technically editable text since ScriptUI's cross-version
    // support for a true readonly edittext is inconsistent; editing it has
    // no effect on anything.
    function addHelpTab(caption, text) {
        var t = tabs.add("tab", undefined, caption);
        t.orientation = "column";
        t.alignChildren = "fill";
        t.margins = 10;
        var et = t.add("edittext", undefined, text, {multiline: true});
        et.preferredSize = [400, 320];
        return et;
    }

    addHelpTab("Help - Basics",
        "WHAT THIS DOES\r" +
        "Starts from a single sticker (a cut rectangle, usually with artwork placed on top and selected alongside it) and tiles it into a grid sized to fill a target width x height (mm) - the column/row counts are worked out automatically from the cut shape's own size. It draws every horizontal and vertical boundary line of the grid - including the sheet's outer edges, not just the internal dividers - as two alternating snake paths: one for all horizontal cuts, one for all vertical cuts.\r\r" +
        "FILL AREA\r" +
        "Give a target width and height (mm); the column/row counts are calculated automatically so the grid fills that area as closely as possible without exceeding it.\r\r" +
        "WHAT TO SELECT\r" +
        "Select exactly ONE closed, axis-aligned rectangle path as the cut line, plus (optionally) any artwork - image, text, group, etc. - that should repeat in every cell.\r\r" +
        "BUILD DIRECTION\r" +
        "The grid always builds to the right and down from the original selection, which stays in place as the top-left cell. The combined path always starts at that same top-left corner, since it's the one corner that never moves as copies are added."
    );

    addHelpTab("Help - Output",
        "GROUPED OUTPUT\r" +
        "Generated cutlines are placed in a group named \"QuikCutz\" (paths QuikCutz_1, QuikCutz_2, ...). Duplicated artwork/images are placed in a separate group named \"Images\" (Image_1, Image_2, ...).\r\r" +
        "SNAKE DIRECTION (fixed, not configurable)\r" +
        "Each internal horizontal divider alternates direction from the one above it: the first (topmost) runs left to right, the next right to left, and so on. Each internal vertical divider alternates from the one to its left: the first (leftmost) runs bottom to top, the next top to bottom, and so on.\r\r" +
        "STUB / JOIN OPTIONS (choose one)\r" +
        "1. No stub extensions: plain grid lines, path one and path two stay as separate unjoined runs, no border.\r" +
        "2. Add stub extensions only: a short straight stub is added past each line's true start/end (length set on the Options tab, default 5mm) so the cut slightly overshoots the grid edge - useful for reliable pierce or tie-off points. Stubs stay unjoined.\r" +
        "3. Add stubs + join with connectors: straight segments join the end of one line to the matching end of the next line in that direction's sequence, so every horizontal divider becomes ONE path and every vertical divider becomes ONE path (path one and path two stay two separate path objects; they are not bridged together). Every corner a connector introduces is automatically rounded with a circular fillet (radius 0.9x the stub length, clamped so it never exceeds the stub length or half the connector's own length).\r" +
        "4. Add stubs + connectors + join path one to path two: everything option 3 does, plus path one's end is joined directly to path two's start with a straight segment, combining them into ONE path with a square (sharp, never filleted) right-angle corner at that one joint.\r" +
        "5. Add stubs + border frame: a rectangle is traced around the array, sitting at the stub-tip extent, in addition to path one and path two (three path objects total: path one, path two, border).\r" +
        "These are mutually exclusive - only one can be active at a time."
    );

    addHelpTab("Help - Options",
        "STUB LENGTH\r" +
        "Sets how far each stub overshoots the true line end (mm). Only takes visible effect on options 2-5; ignored on option 1.\r\r" +
        "KEEP ORIGINAL OBJECT(S)\r" +
        "Off (default): the original cut rectangle is removed once the grid is built, and the original artwork you selected becomes part of the \"Images\" group (as its first copy) rather than being duplicated a second time. On: the original cut rectangle and every originally selected artwork/image are left exactly where they are, untouched - the new QuikCutz and Images groups are generated as entirely separate, additional objects.\r\r" +
        "DEMO MODE\r" +
        "Colors path one (horizontal cuts) red, path two (vertical cuts) blue, and the outer box or H-to-V bracket join green, purely to make the logic easy to check visually before cutting.\r\r" +
        "NOTE\r" +
        "This tool does not include a \"Rasterize duplicated artwork into a single image\" option. Duplicated artwork is always left as separate objects inside the Images group."
    );

    // ---- OK / Cancel ----
    var gBtns = win.add("group");
    gBtns.alignment = "right";
    var btnCancel = gBtns.add("button", undefined, "Cancel", {name: "cancel"});
    var btnOK = gBtns.add("button", undefined, "OK", {name: "ok"});

    var result = null;

    btnOK.onClick = function () {
        var fw = parseFloat(etW.text);
        var fh = parseFloat(etH.text);
        var el = parseFloat(etExt.text);

        if (isNaN(fw) || fw <= 0) {
            alert("Enter a valid fill area width (mm).");
            tabs.selection = tabOptions;
            etW.active = true;
            return;
        }
        if (isNaN(fh) || fh <= 0) {
            alert("Enter a valid fill area height (mm).");
            tabs.selection = tabOptions;
            etH.active = true;
            return;
        }
        if (isNaN(el) || el < 0) {
            alert("Enter a valid stub length (mm).");
            tabs.selection = tabOptions;
            etExt.active = true;
            return;
        }

        var layoutOption = "opt1";
        if (rb2.value) layoutOption = "opt2";
        else if (rb3.value) layoutOption = "opt3";
        else if (rb4.value) layoutOption = "opt4";
        else if (rb5.value) layoutOption = "opt5";

        result = {
            fillWidthMM: fw,
            fillHeightMM: fh,
            extensionLength: el,
            layoutOption: layoutOption,
            keepOriginals: ckKeep.value,
            testMode: ckTest.value
        };
        win.close(1);
    };

    btnCancel.onClick = function () {
        win.close(0);
    };

    var ret = win.show();
    if (ret !== 1) return null;
    return result;
}

// ============================ Run ============================================

try {
    runQuikCutz();
} catch (err) {
    alert("Quik Cutz error: " + err);
}

})();
