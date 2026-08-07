// ================================================================
// SnakeCutz.jsx - Adobe Illustrator ExtendScript port
// Ports the CorelDRAW VBA "Snake Cutz" macro (SnakeCutz.bas) - which
// itself mirrors the Inkscape extension snake_cutz.py/.inx - to
// Illustrator scripting. CIRCLE/ELLIPSE-ONLY, same as both of those.
//
// FEATURE PARITY with SnakeCutz.bas (current version, rasterize
// option removed):
//   - Fill-area sizing: give a target width/height (mm); copies per
//     chain and number of parallel chains are worked out automatically
//     (computeFillCounts) so the layout fills that area as closely as
//     possible without exceeding it.
//   - Build direction: Horizontal / Vertical
//   - Multiple parallel duplicate chains, with an adjustable gap (mm)
//   - Optional straight-line connectors joining every chain into ONE
//     continuous path, or leaving each chain as its own closed path
//   - Keep original cut shape + originally-selected artwork (off by
//     default - the original cut shape is deleted and the original
//     artwork is folded into the generated "Images" group)
//   - Demo/test mode: forward pass (red), return pass (blue), and
//     connectors (green) as separate open paths for checking
//     alignment before committing to a real cut
//   - Content duplication: any other selected items (paths, text,
//     placed/raster images, groups) are duplicated at every circle
//     position in every chain
//   - Grouping/naming: generated cutlines go in a group named
//     "SnakeCutz" (children SnakeCutz_1, SnakeCutz_2, ...); duplicated
//     artwork goes in a separate group named "Images" (children
//     Image_1, Image_2, ...)
//   - NOT included: "Rasterize duplicated artwork" - this was removed
//     from the CorelDRAW version too (it kept hitting API calls that
//     didn't behave the way assumed, with no reliable way to verify
//     without a live host). If you want it here, Illustrator's
//     equivalent would be PageItem.rasterize() on the "Images" group,
//     called before it gets grouped/named.
//
// KEY DIFFERENCE FROM THE CORELDRAW VERSION - ELLIPSE DETECTION:
// Illustrator has no distinct "ellipse" shape type at the scripting
// level - everything is a PathItem. There's no equivalent of
// CorelDRAW's Shape.Type = cdrEllipseShape to check. Instead, this
// script uses a heuristic: a CLOSED path with EXACTLY 4 anchor points
// (what the Ellipse tool produces) is treated as the cut shape. Any
// other closed 4-point path (e.g. a diamond drawn with the Pen tool)
// will also pass this check and be misidentified - it's a heuristic,
// not a guarantee. If that's a problem in practice, tighten
// isEllipseLike() to also check that opposite anchor points sit at
// equal distances from the bounding-box center (a true ellipse's 4
// anchors are its top/right/bottom/left poles).
//
// COORDINATE SYSTEM: Illustrator's scripting DOM uses a Cartesian,
// Y-UP coordinate system (positive Y is up), same convention as
// CorelDRAW's VBA object model - so the same direction-sign handling
// from SnakeCutz.bas (ResolveDirection / the H1-H2 reversal for
// negative signMul) is ported here unchanged. This has NOT been
// re-verified against a live Illustrator install, only carried over
// from what testing confirmed correct in CorelDRAW - if "Vertical"
// builds upward instead of downward on your screen, flip the signMul
// values in resolveDirection().
//
// HOW TO INSTALL: File > Scripts > Other Script... and pick this
// file, or drop it into Illustrator's own Scripts folder (typically
// .../Adobe Illustrator .../Presets/<language>/Scripts/) so it shows
// up directly under File > Scripts.
//
// HOW TO RUN: select the cut circle/ellipse (plus, optionally, any
// artwork to duplicate with it), then run this script. A dialog opens
// with Options / Help (1/2) / Help (2/2) tabs.
// ================================================================

#target illustrator

// ---------------- constants ----------------

var PT_PER_MM = 72 / 25.4;
var BEZIER_K = 0.552284749830794; // circle/ellipse Bezier approximation constant

// ---------------- small geometry helpers ----------------
// (mirrors Pt / CubicSeg / TranslateFragment / ReverseFragment /
// BuildEllipseHalves / BuildPass from SnakeCutz.bas, translated to
// plain JS objects instead of VBA Types)

function pt(x, y) {
    return { x: x, y: y };
}

function translateFragment(frag, dx, dy) {
    var out = [];
    for (var i = 0; i < frag.length; i++) {
        var s = frag[i];
        out.push({
            p0: pt(s.p0.x + dx, s.p0.y + dy),
            p1: pt(s.p1.x + dx, s.p1.y + dy),
            p2: pt(s.p2.x + dx, s.p2.y + dy),
            p3: pt(s.p3.x + dx, s.p3.y + dy)
        });
    }
    return out;
}

function reverseFragment(frag) {
    var out = [];
    for (var i = frag.length - 1; i >= 0; i--) {
        var s = frag[i];
        out.push({ p0: s.p3, p1: s.p2, p2: s.p1, p3: s.p0 });
    }
    return out;
}

// Build the two half-ellipse fragments analytically, same layout as
// BuildEllipseHalves in SnakeCutz.bas:
//   H1 goes start-pole -> end-pole (via one side).
//   H2 goes end-pole -> start-pole (via the other side).
// vertical=true:  start pole = top (cx, cy+ry), end pole = bottom (cx, cy-ry)
//                 [Y-UP: "top" = larger Y], H1 via the RIGHT side, H2 via LEFT.
// vertical=false: start pole = left (cx-rx, cy), end pole = right (cx+rx, cy),
//                 H1 via the BOTTOM side, H2 via the TOP side.
function buildEllipseHalves(cx, cy, rx, ry, vertical) {
    var kx = BEZIER_K * rx, ky = BEZIER_K * ry;
    var H1 = [], H2 = [];

    if (vertical) {
        var topPt = pt(cx, cy + ry);
        var botPt = pt(cx, cy - ry);
        var rightPt = pt(cx + rx, cy);
        var leftPt = pt(cx - rx, cy);

        // H1: top -> right -> bottom
        H1.push({ p0: topPt, p1: pt(cx + kx, cy + ry), p2: pt(cx + rx, cy + ky), p3: rightPt });
        H1.push({ p0: rightPt, p1: pt(cx + rx, cy - ky), p2: pt(cx + kx, cy - ry), p3: botPt });

        // H2: bottom -> left -> top
        H2.push({ p0: botPt, p1: pt(cx - kx, cy - ry), p2: pt(cx - rx, cy - ky), p3: leftPt });
        H2.push({ p0: leftPt, p1: pt(cx - rx, cy + ky), p2: pt(cx - kx, cy + ry), p3: topPt });
    } else {
        var leftPt2 = pt(cx - rx, cy);
        var rightPt2 = pt(cx + rx, cy);
        var topPt2 = pt(cx, cy + ry);
        var botPt2 = pt(cx, cy - ry);

        // H1: left -> bottom -> right
        H1.push({ p0: leftPt2, p1: pt(cx - rx, cy - ky), p2: pt(cx - kx, cy - ry), p3: botPt2 });
        H1.push({ p0: botPt2, p1: pt(cx + kx, cy - ry), p2: pt(cx + rx, cy - ky), p3: rightPt2 });

        // H2: right -> top -> left
        H2.push({ p0: rightPt2, p1: pt(cx + rx, cy + ky), p2: pt(cx + kx, cy + ry), p3: topPt2 });
        H2.push({ p0: topPt2, p1: pt(cx - kx, cy + ry), p2: pt(cx - rx, cy + ky), p3: leftPt2 });
    }

    return { H1: H1, H2: H2 };
}

// Build one pass (forward or return) across all copies as a flat
// segment array, positions already applied. Mirrors BuildPass.
function buildPass(H1, H2, copies, vertical, spacing, forward) {
    var all = [];
    for (var k = 0; k < copies; k++) {
        var i = forward ? k : (copies - 1 - k);
        var useOdd = (i % 2 !== 0);
        var frag;
        if (forward) {
            frag = useOdd ? reverseFragment(H2) : H1;
        } else {
            frag = useOdd ? reverseFragment(H1) : H2;
        }
        var dx = 0, dy = 0;
        if (vertical) { dy = i * spacing; } else { dx = i * spacing; }
        var fragT = translateFragment(frag, dx, dy);
        for (var j = 0; j < fragT.length; j++) all.push(fragT[j]);
    }
    return all;
}

// A straight connector between two points, represented as a
// degenerate segment (zero-length handles) - mirrors MakeConnector.
function makeConnector(fromPt, toPt) {
    return { p0: fromPt, p1: fromPt, p2: toPt, p3: toPt };
}

// ---------------- direction handling ----------------
// Mirrors ResolveDirection in SnakeCutz.bas, including the same
// signMul convention (ported, not independently re-verified here -
// see the COORDINATE SYSTEM note at the top of this file).
function resolveDirection(dirCode) {
    switch (dirCode) {
        case "Down":  return { vertical: true,  signMul: -1 };
        case "Up":    return { vertical: true,  signMul: 1 };
        case "Right": return { vertical: false, signMul: 1 };
        case "Left":  return { vertical: false, signMul: -1 };
        default:      return { vertical: true,  signMul: -1 }; // fallback: Down
    }
}

// ---------------- fill-area sizing ----------------
// Direct port of ComputeFillCounts, in points instead of inches
// (Illustrator's scripting DOM always works in points internally).
function computeFillCounts(fillWidthPts, fillHeightPts, vertical, rx, ry, chainGapPts) {
    var primaryExtent = vertical ? fillHeightPts : fillWidthPts;
    var secondaryExtent = vertical ? fillWidthPts : fillHeightPts;

    var spacingMag = vertical ? 2 * ry : 2 * rx;
    var perpDiameter = vertical ? 2 * rx : 2 * ry;

    if (spacingMag <= 0) {
        return { copiesPerChain: 0, numChains: 0 };
    }

    var copiesPerChain = Math.floor(primaryExtent / spacingMag);

    var denom = perpDiameter + chainGapPts;
    var numChains;
    if (denom <= 0) {
        numChains = 1;
    } else {
        numChains = Math.floor((secondaryExtent + chainGapPts) / denom);
        if (numChains < 1) numChains = 1;
    }

    return { copiesPerChain: copiesPerChain, numChains: numChains };
}

// ---------------- shape identification / geometry ----------------

// Heuristic proxy for "circle/ellipse" - see the header comment's
// KEY DIFFERENCE note for why this can't be a reliable type check the
// way it is in CorelDRAW.
function isEllipseLike(item) {
    try {
        return (item.typename === "PathItem" && item.closed === true && item.pathPoints.length === 4);
    } catch (e) {
        return false;
    }
}

// Reads center/radii from a path's geometric bounding box.
// geometricBounds returns [left, top, right, bottom] with top > bottom
// (Y-up), unlike CorelDRAW's direct CenterX/CenterY/SizeWidth/
// SizeHeight properties - this is standard, well-documented
// Illustrator DOM behavior.
function getEllipseGeometry(item) {
    var b = item.geometricBounds;
    var left = b[0], top = b[1], right = b[2], bottom = b[3];
    return {
        cx: (left + right) / 2,
        cy: (top + bottom) / 2,
        rx: (right - left) / 2,
        ry: (top - bottom) / 2
    };
}

// ---------------- path construction ----------------

// Adds len(segs)+1 anchor points to an empty PathItem from a
// continuous segment array (segs[i].p3 == segs[i+1].p0). Each
// PathPoint's anchor/leftDirection/rightDirection are absolute
// coordinates in Illustrator's DOM - no length/angle conversion
// needed here, unlike CorelDRAW's AppendCurveSegment.
function addCurvePoints(path, segs) {
    var p0 = path.pathPoints.add();
    p0.anchor = [segs[0].p0.x, segs[0].p0.y];
    p0.leftDirection = p0.anchor;
    p0.rightDirection = [segs[0].p1.x, segs[0].p1.y];

    for (var i = 0; i < segs.length; i++) {
        var np = path.pathPoints.add();
        np.anchor = [segs[i].p3.x, segs[i].p3.y];
        np.leftDirection = [segs[i].p2.x, segs[i].p2.y];
        np.rightDirection = (i + 1 < segs.length) ? [segs[i + 1].p1.x, segs[i + 1].p1.y] : np.anchor;
    }
}

// For a genuinely closed loop (last point coincides exactly with the
// first, by construction - forward+return passes meet up), Illustrator
// would otherwise draw an extra/duplicate closing segment on top of
// the one we already built. Instead: transfer the coincident last
// point's incoming handle onto the real first point, remove the
// duplicate, then mark the path closed - Illustrator then connects the
// remaining last point back to point[0] using exactly the handles we
// already computed.
function closeCurvePath(path) {
    var pts = path.pathPoints;
    var n = pts.length;
    if (n < 2) { path.closed = true; return; }
    var lastPt = pts[n - 1];
    var firstPt = pts[0];
    firstPt.leftDirection = lastPt.leftDirection;
    lastPt.remove();
    path.closed = true;
}

function emitOpenPath(layer, segs) {
    var path = layer.pathItems.add();
    addCurvePoints(path, segs);
    path.closed = false;
    path.filled = false;
    return path;
}

function emitClosedPath(layer, segs) {
    var path = layer.pathItems.add();
    addCurvePoints(path, segs);
    closeCurvePath(path);
    path.filled = false;
    return path;
}

function makeRGBColor(r, g, b) {
    var c = new RGBColor();
    c.red = r; c.green = g; c.blue = b;
    return c;
}

function styleTest(path, rgb) {
    path.stroked = true;
    path.strokeColor = makeRGBColor(rgb[0], rgb[1], rgb[2]);
    path.strokeWidth = 1;
    path.filled = false;
}

function copyStrokeFrom(path, sourceItem) {
    path.stroked = sourceItem.stroked;
    if (sourceItem.stroked) {
        path.strokeColor = sourceItem.strokeColor;
        path.strokeWidth = sourceItem.strokeWidth;
    }
}

function duplicateContent(item, dx, dy) {
    var dup = item.duplicate();
    dup.translate(dx, dy);
    return dup;
}

// ---------------- grouping ----------------
// Much simpler and better-documented than the CorelDRAW version:
// GroupItems.add() + PageItem.move() work uniformly whether there's
// one item or many - no "some hosts refuse to group a single object"
// fallback needed here.
function groupShapes(doc, items, name) {
    if (items.length === 0) return null;
    var grp = doc.groupItems.add();
    for (var i = 0; i < items.length; i++) {
        items[i].move(grp, ElementPlacement.PLACEATEND);
    }
    grp.name = name;
    return grp;
}

// ================================================================
// MAIN ENTRY POINT
//   o.fillWidthMM, o.fillHeightMM: target fill-area size, mm. Copies
//       per chain and chain count are derived automatically - see
//       computeFillCounts.
//   o.dirCode: "Right" (Horizontal) or "Down" (Vertical) from the
//       dialog - "Up"/"Left" also work if called directly.
//   o.chainGapMM: extra space between adjacent chains, mm.
//   o.addConnectors: if numChains>1, join chains with a straight line
//       into ONE continuous path (only affects normal mode; demo mode
//       always shows connectors separately in green).
//   o.keepOriginal: if false (default), the original cut path is
//       deleted once the chain is generated, and the originally-
//       selected artwork (which stood in for chain 0/copy 0 instead of
//       being duplicated a second time) is folded into the "Images"
//       group afterward - same label-ordering quirk as the Python/
//       CorelDRAW versions (originals get the LAST Image_N labels).
//       If true, originals are left untouched and every position gets
//       its own fresh duplicate.
//   o.testMode: demo mode - forward pass (red) / return pass (blue) /
//       connectors (green) as separate open paths, still grouped into
//       "SnakeCutz" with fixed descriptive names.
// ================================================================
function runSnakeCutz(doc, o) {
    var chainGapPts = o.chainGapMM * PT_PER_MM;

    var sel = doc.selection;
    if (!sel || sel.length < 1) {
        alert("Select the cut circle/ellipse (plus, optionally, any artwork to duplicate with it).");
        return;
    }

    var cutShape = null;
    var contentShapes = [];
    for (var i = 0; i < sel.length; i++) {
        var it = sel[i];
        if (isEllipseLike(it)) {
            if (cutShape) {
                alert("Select only ONE circle/ellipse as the cut shape (plus any artwork/text to go with it).");
                return;
            }
            cutShape = it;
        } else {
            contentShapes.push(it);
        }
    }
    if (!cutShape) {
        alert("No circle/ellipse found in the selection to use as the cut shape.");
        return;
    }

    if (o.fillWidthMM <= 0 || o.fillHeightMM <= 0) {
        alert("Fill area width/height must be greater than 0.");
        return;
    }

    var geo = getEllipseGeometry(cutShape);
    var cx = geo.cx, cy = geo.cy, rx = geo.rx, ry = geo.ry;

    var dir = resolveDirection(o.dirCode);
    var vertical = dir.vertical, signMul = dir.signMul;

    var fillWidthPts = o.fillWidthMM * PT_PER_MM;
    var fillHeightPts = o.fillHeightMM * PT_PER_MM;
    var counts = computeFillCounts(fillWidthPts, fillHeightPts, vertical, rx, ry, chainGapPts);
    var copiesPerChain = counts.copiesPerChain, numChains = counts.numChains;

    if (copiesPerChain < 2) {
        alert("Fill Area is too small to fit at least 2 copies along the build direction. Increase the fill size or shrink the cut shape.");
        return;
    }
    if (numChains < 1) {
        alert("Number of chains must be 1 or more.");
        return;
    }

    var halves = buildEllipseHalves(cx, cy, rx, ry, vertical);
    var H1 = halves.H1, H2 = halves.H2;
    // Whether H1/H2 need reversing to stay continuous from one circle to
    // the next depends on the build axis, not just the sign of signMul:
    // vertical builds are naturally continuous at signMul=-1 ("Down");
    // horizontal builds are naturally continuous at signMul=+1 ("Right").
    // Reversal is only needed on the OTHER signMul for each axis - an
    // earlier version of this had that backwards (reversed exactly the
    // cases that didn't need it), which produced the bowtie/loop and
    // long-diagonal-chord pattern seen in snakecuts-1.svg. Worked out by
    // hand-tracing where consecutive circles' touching poles actually
    // land; not yet re-confirmed by re-running this exact file.
    var canonicalSign = vertical ? -1 : 1;
    if (signMul !== canonicalSign) {
        H1 = reverseFragment(H1);
        H2 = reverseFragment(H2);
    }

    var spacing = vertical ? (2 * ry * signMul) : (2 * rx * signMul);
    var perpDiameter = vertical ? (2 * rx) : (2 * ry);

    var layer = doc.activeLayer;

    var combined = [];
    var prevStart = null;
    var cutShapesArr = [];
    var imagesArr = [];
    var cutCounter = 0;
    var imageCounter = 0;

    for (var k = 0; k < numChains; k++) {
        var perpOffset = k * (perpDiameter + chainGapPts);
        var cdx = 0, cdy = 0;
        // Same perpendicular-offset sign handling as SnakeCutz.bas:
        // vertical mode offsets rows along X (unaffected by direction);
        // horizontal mode offsets rows along Y, negated so extra rows
        // stack below the first one rather than above (Y-up).
        if (vertical) { cdx = perpOffset; } else { cdy = -perpOffset; }

        var fwd = translateFragment(buildPass(H1, H2, copiesPerChain, vertical, spacing, true), cdx, cdy);
        var bck = translateFragment(buildPass(H1, H2, copiesPerChain, vertical, spacing, false), cdx, cdy);

        var thisStart = fwd[0].p0;

        // Duplicate artwork at every circle position in this chain -
        // same keep-originals logic (and bug fix) as SnakeCutz.bas.
        for (var ii = 0; ii < copiesPerChain; ii++) {
            if (o.keepOriginal || !(k === 0 && ii === 0)) {
                var adx = cdx, ady = cdy;
                if (vertical) { ady = cdy + ii * spacing; } else { adx = cdx + ii * spacing; }
                for (var c = 0; c < contentShapes.length; c++) {
                    var dup = duplicateContent(contentShapes[c], adx, ady);
                    imageCounter++;
                    dup.name = "Image_" + imageCounter;
                    imagesArr.push(dup);
                }
            }
        }

        if (o.testMode) {
            var fwdPath = emitOpenPath(layer, fwd);
            styleTest(fwdPath, [255, 0, 0]);
            fwdPath.name = "Snake Cutz TEST - forward (red)";
            cutShapesArr.push(fwdPath);

            var bckPath = emitOpenPath(layer, bck);
            styleTest(bckPath, [0, 0, 255]);
            bckPath.name = "Snake Cutz TEST - return (blue)";
            cutShapesArr.push(bckPath);

            if (k > 0 && o.addConnectors) {
                var connPath = emitOpenPath(layer, [makeConnector(prevStart, thisStart)]);
                styleTest(connPath, [0, 200, 0]);
                connPath.name = "Snake Cutz TEST - connector (green)";
                cutShapesArr.push(connPath);
            }
        } else {
            if (numChains === 1 || o.addConnectors) {
                if (k > 0) {
                    combined.push(makeConnector(prevStart, thisStart));
                }
                combined = combined.concat(fwd, bck);
            } else {
                // Multiple chains, no connectors: each chain is its own
                // independent closed path - name/collect it right here.
                var chainPath = emitClosedPath(layer, fwd.concat(bck));
                copyStrokeFrom(chainPath, cutShape);
                cutCounter++;
                chainPath.name = "SnakeCutz_" + cutCounter;
                cutShapesArr.push(chainPath);
            }
        }

        prevStart = thisStart;
    }

    if (!o.testMode && (numChains === 1 || o.addConnectors)) {
        var doClose = (numChains === 1);
        var combinedPath = doClose ? emitClosedPath(layer, combined) : emitOpenPath(layer, combined);
        copyStrokeFrom(combinedPath, cutShape);
        cutCounter++;
        combinedPath.name = "SnakeCutz_" + cutCounter;
        cutShapesArr.push(combinedPath);
    }

    // Fold the originally-selected artwork into the Images group too,
    // unless keeping originals untouched - gets the LAST Image_N
    // labels, matching the Python/CorelDRAW ordering quirk.
    if (!o.keepOriginal) {
        for (var cc = 0; cc < contentShapes.length; cc++) {
            imageCounter++;
            contentShapes[cc].name = "Image_" + imageCounter;
            imagesArr.push(contentShapes[cc]);
        }
        cutShape.remove();
    }

    groupShapes(doc, cutShapesArr, "SnakeCutz");
    groupShapes(doc, imagesArr, "Images");

    alert("Snake Cutz chain generated.");
}

// ================================================================
// HELP TEXT (ported from snake_cutz.inx's "help"/"help2" notebook
// pages - the "Rasterize duplicated artwork" paragraph from help2 is
// dropped since that option doesn't exist here)
// ================================================================

var HELP1_TEXT =
    "SNAKE CUTZ - HOW IT WORKS\n" +
    "Select ONE closed 4-point path (what the Ellipse tool produces) as the cut line. Anything else is likely to be misidentified or rejected - see the isEllipseLike() note at the top of this script.\n\n" +
    "Optionally also select artwork (path, text, placed image, or a group) alongside the cut shape. It will be duplicated at every position in the chain, so a sticker design - including raster images - repeats automatically.\n\n" +
    "FILL AREA\n" +
    "Give a target width and height (mm); the copy-per-chain and chain counts are calculated automatically so the layout fills that area as closely as possible without exceeding it.\n\n" +
    "BUILD DIRECTION\n" +
    "Horizontal builds the chain left to right. Vertical builds it top to bottom. Each circle's pole touches the next circle's pole so they sit tangent with no gaps.\n\n" +
    "MULTIPLE CHAINS\n" +
    "The chain count is derived from the Fill Area height/width (whichever runs perpendicular to the build direction) and the \"Gap between chains\" value (in mm) - each chain is offset from the next by the shape's own diameter plus that gap. Turn on \"Connect chains\" to join them into a single continuous cut path; leave it off to keep each chain as its own separate closed path.";

var HELP2_TEXT =
    "GROUPING\n" +
    "All generated cutlines are placed in a group named \"SnakeCutz\", with each path named SnakeCutz_1, SnakeCutz_2, and so on. All duplicated artwork/images are placed in a separate group named \"Images\", with each copy named Image_1, Image_2, and so on.\n\n" +
    "KEEP ORIGINAL OBJECT(S)\n" +
    "Off (default): the original cut shape is removed once the chain is generated, and the original artwork you selected becomes part of the \"Images\" group (as its first copy) rather than being duplicated a second time. On: the original cut shape and every originally selected artwork/image are left exactly where they are, untouched - the new SnakeCutz and Images groups are generated as entirely separate, additional objects.\n\n" +
    "DEMO MODE\n" +
    "Turns on a preview pass instead of the real cut line: the forward pass is drawn in red, the return pass in blue, and any connectors in green, all as separate open paths inside the \"SnakeCutz\" group. Use this to check alignment before committing to a real cut.";

// ================================================================
// UI - ScriptUI tabbed dialog (Options / Help (1/2) / Help (2/2))
// ================================================================

function showDialog(doc) {
    var win = new Window("dialog", "Snake Cutz");
    win.orientation = "column";
    win.alignChildren = "fill";

    var tpanel = win.add("tabbedpanel");
    tpanel.alignChildren = "fill";
    tpanel.preferredSize = [420, 380];

    // ---- Options tab ----
    var tabOptions = tpanel.add("tab", undefined, "Options");
    tabOptions.orientation = "column";
    tabOptions.alignChildren = "left";
    tabOptions.margins = 10;

    var dirPanel = tabOptions.add("panel", undefined, "Build direction");
    dirPanel.orientation = "row";
    dirPanel.margins = 10;
    var rbHoriz = dirPanel.add("radiobutton", undefined, "Horizontal (build left to right)");
    var rbVert = dirPanel.add("radiobutton", undefined, "Vertical (build top to bottom)");
    rbVert.value = true;

    var fwGroup = tabOptions.add("group");
    fwGroup.add("statictext", undefined, "Fill area width (mm):");
    var fwField = fwGroup.add("edittext", undefined, "100");
    fwField.characters = 8;

    var fhGroup = tabOptions.add("group");
    fhGroup.add("statictext", undefined, "Fill area height (mm):");
    var fhField = fhGroup.add("edittext", undefined, "100");
    fhField.characters = 8;

    var cgGroup = tabOptions.add("group");
    cgGroup.add("statictext", undefined, "Gap between chains (mm):");
    var cgField = cgGroup.add("edittext", undefined, "0");
    cgField.characters = 8;

    var chkConnect = tabOptions.add("checkbox", undefined, "Connect chains with a straight line (single continuous path)");
    chkConnect.value = true;

    var chkKeep = tabOptions.add("checkbox", undefined, "Keep original object(s) (cut shape + artwork/images, untouched)");
    chkKeep.value = false;

    var chkTest = tabOptions.add("checkbox", undefined, "Demo mode: forward=red, return=blue, connectors=green");
    chkTest.value = false;

    var noteText = tabOptions.add("statictext", undefined,
        "Select ONE closed 4-point path as the cut line, plus optionally any artwork to repeat with each copy. See Help tabs for details.",
        { multiline: true });
    noteText.preferredSize.width = 380;

    // ---- Help (1/2) tab ----
    var tabHelp1 = tpanel.add("tab", undefined, "Help (1/2)");
    tabHelp1.orientation = "column";
    tabHelp1.alignChildren = "fill";
    tabHelp1.margins = 10;
    var help1Field = tabHelp1.add("edittext", undefined, HELP1_TEXT,
        { multiline: true, scrollable: true, readonly: true });
    help1Field.preferredSize = [380, 300];

    // ---- Help (2/2) tab ----
    var tabHelp2 = tpanel.add("tab", undefined, "Help (2/2)");
    tabHelp2.orientation = "column";
    tabHelp2.alignChildren = "fill";
    tabHelp2.margins = 10;
    var help2Field = tabHelp2.add("edittext", undefined, HELP2_TEXT,
        { multiline: true, scrollable: true, readonly: true });
    help2Field.preferredSize = [380, 300];

    tpanel.selection = tabOptions;

    // ---- OK / Cancel (outside the tabs, always visible) ----
    var btnGroup = win.add("group");
    btnGroup.alignment = "right";
    var btnCancel = btnGroup.add("button", undefined, "Cancel", { name: "cancel" });
    var btnOK = btnGroup.add("button", undefined, "OK", { name: "ok" });

    btnOK.onClick = function () {
        var fillWidth = parseFloat(fwField.text);
        var fillHeight = parseFloat(fhField.text);
        var chainGap = parseFloat(cgField.text);

        if (isNaN(fillWidth) || fillWidth <= 0) {
            alert("Fill area width must be a number greater than 0.");
            tpanel.selection = tabOptions;
            fwField.active = true;
            return;
        }
        if (isNaN(fillHeight) || fillHeight <= 0) {
            alert("Fill area height must be a number greater than 0.");
            tpanel.selection = tabOptions;
            fhField.active = true;
            return;
        }
        if (isNaN(chainGap)) {
            alert("Gap between chains must be a number.");
            tpanel.selection = tabOptions;
            cgField.active = true;
            return;
        }

        var dirCode = rbVert.value ? "Down" : "Right";

        win.close();

        runSnakeCutz(doc, {
            fillWidthMM: fillWidth,
            fillHeightMM: fillHeight,
            dirCode: dirCode,
            chainGapMM: chainGap,
            addConnectors: chkConnect.value,
            keepOriginal: chkKeep.value,
            testMode: chkTest.value
        });
    };

    btnCancel.onClick = function () {
        win.close();
    };

    win.show();
}

// ================================================================
// MAIN
// ================================================================
function main() {
    if (app.documents.length === 0) {
        alert("Open a document first.");
        return;
    }
    var doc = app.activeDocument;
    if (doc.selection.length < 1) {
        alert("Select the cut circle/ellipse (plus, optionally, any artwork to duplicate with it) first, then run this script.");
        return;
    }
    showDialog(doc);
}

main();
