I'm not a coder — much of this was created using AI.

# QuikCutz & SnakeCutz for Adobe Illustrator

Two Adobe Illustrator scripts (`.jsx`) for turning a single sticker/label shape into a repeated grid or chain of cut lines, ready for a cutting plotter. They're Illustrator ports of the original Inkscape extensions and CorelDRAW VBA macros of the same names.

- **QuikCutzGrid.jsx** — tiles a **rectangular** sticker into a grid.
- **SnakeCutz.jsx** — tiles a **circle/ellipse** sticker into a snaking chain.

Both scripts take your one sticker shape (plus any artwork on top of it), figure out how many copies fit into a target sheet size, duplicate the artwork into every position, and draw the cut lines for you.

---

## Installation

Illustrator scripts don't need to be "installed" in the traditional sense — you either run them directly from a file, or drop them into Illustrator's Scripts folder so they show up in the menu.

**Option A — Run once, from anywhere:**
1. Save the `.jsx` file anywhere on your computer.
2. In Illustrator: `File > Scripts > Other Script...`
3. Browse to the file and open it.

**Option B — Add it to the Scripts menu permanently:**
1. Close Illustrator.
2. Copy the `.jsx` file into Illustrator's Scripts folder, e.g.:
   - **Windows:** `C:\Program Files\Adobe\Adobe Illustrator [version]\Presets\en_US\Scripts\`
   - **Mac:** `/Applications/Adobe Illustrator [version]/Presets/en_US/Scripts/`
3. Restart Illustrator. The script now appears under `File > Scripts > QuikCutzGrid` (or `SnakeCutz`).

---

## QuikCutzGrid.jsx

### What it does
Takes a single **rectangular** sticker — a rectangle path, usually with artwork placed on top — and tiles it into a grid sized to fill a target width × height (in mm). The number of rows/columns is worked out automatically from the size of your rectangle. It then draws every cut line in the grid (including the outer edges of the sheet, not just the internal dividers) as two "snake" paths: one that zigzags through all the horizontal cuts, and one that zigzags through all the vertical cuts. This snake pattern is meant to minimize pen-up travel on a cutting plotter.
       
<img width="546" height="485" alt="202608071725" src="https://github.com/user-attachments/assets/6729ba8c-b9c5-46fd-9ecc-ec43e3d9dacc" />

<img width="334" height="336" alt="202608073150" src="https://github.com/user-attachments/assets/c8c31f64-b8ba-4015-8c2f-4fec39c47095" />


         

### What to select before running
Select exactly **one** closed, axis-aligned rectangle (the cut line) — a plain rectangle, not one with rounded corners. Optionally also select any artwork (image, text, group, etc.) you want repeated in every cell.

### How to use it
1. Draw or place your rectangle where you want the top-left sticker to sit, with your artwork on top of it.
2. Select the rectangle plus the artwork.
3. Run the script (`File > Scripts > QuikCutzGrid`).
4. In the dialog:
   - **Fill area width / height (mm):** the overall sheet size you want the grid to fill.
   - **Stub / Join options:** choose one —
     1. No stub extensions — plain grid lines, nothing joined.
    
          <img width="307" height="306" alt="202608073152" src="https://github.com/user-attachments/assets/31bab4ca-95a3-417e-b612-863627e0572d" />
     2. Add stub extensions only — each line overshoots its true end slightly (good for clean pierce points).
    
          <img width="332" height="331" alt="202608073153" src="https://github.com/user-attachments/assets/9b486434-63b8-4c3c-88f4-b613dd73ae8d" />
     3. Add stubs + join with connectors — each full row/column of cuts becomes one continuous path.
    
          <img width="332" height="333" alt="202608073154" src="https://github.com/user-attachments/assets/2b3de9ef-bd63-47bf-a297-1053079ae040" />     
     4. Add stubs + connectors + join path one to path two — same as above, plus the horizontal and vertical paths are joined into a single path with a square corner.
    
           <img width="331" height="336" alt="202608073159" src="https://github.com/user-attachments/assets/7a3e17f0-0f09-4268-ae58-3ba61f82453b" />
     5. Add stubs + border frame — adds a rectangle traced around the whole grids.
    
           <img width="330" height="338" alt="202608073158" src="https://github.com/user-attachments/assets/356f2a77-458e-4411-bd33-1bb30e63841f" />
   - **Stub length (mm):** how far stubs overshoot (only matters for options 2–5).
   - **Keep original object(s):** leave your original rectangle/artwork untouched instead of having it get absorbed into the generated groups.
   - **Demo mode:** colors the horizontal cuts red, vertical cuts blue, and border/join green, so you can sanity-check the layout before cutting anything for real.
5. Click OK. The grid builds to the right and down from your original shape, which becomes the top-left cell.

### Output
- Cut lines go into a group called **QuikCutz** (`QuikCutz_1`, `QuikCutz_2`, ...).
- Duplicated artwork goes into a separate group called **Images** (`Image_1`, `Image_2`, ...).

---

## SnakeCutz.jsx

<img width="306" height="332" alt="202608073144" src="https://github.com/user-attachments/assets/a7bd7ff4-174f-4802-8bb5-4c0edec5a06f" />
<img width="466" height="485" alt="202608071727" src="https://github.com/user-attachments/assets/af3139fa-d423-4915-8524-9dfe2b4aec40" />

               
               
### What it does
Takes a single **circle or ellipse** sticker and repeats it in a tangent chain — each circle touching the next — building either horizontally or vertically to fill a target width × height (mm). You can also generate multiple parallel chains with a gap between them, optionally joined into one continuous cut path.

### What to select before running
Select exactly **one** closed circle/ellipse (i.e., what the Ellipse tool produces) as the cut shape. Optionally also select any artwork to duplicate at every position.

### How to use it
1. Draw your circle/ellipse where the first sticker should sit, with artwork on top if you have any.
2. Select the circle/ellipse plus the artwork.
3. Run the script (`File > Scripts > SnakeCutz`).
4. In the dialog:
   - **Build direction:** Horizontal (left to right) or Vertical (top to bottom).
   - **Fill area width / height (mm):** the sheet size the chain(s) should fill.
   - **Gap between chains (mm):** spacing between parallel chains, if more than one fits.
   - **Connect chains:** joins all chains into a single continuous cut path with straight connector lines; leave off to keep each chain as its own separate closed path.
  
          <img width="313" height="330" alt="202608073146" src="https://github.com/user-attachments/assets/25bea1cb-15f0-46d1-8c6e-657b38ae0f35" />      <img width="309" height="334" alt="202608073145" src="https://github.com/user-attachments/assets/88644528-344f-4062-a239-5e36ba4c05c0" />
     
   - **Keep original object(s):** leave your original shape/artwork untouched.
   - **Demo mode:** shows the forward pass in red, the return pass in blue, and connectors in green, so you can check alignment before cutting.
5. Click OK.

### Output
- Cut lines go into a group called **SnakeCutz** (`SnakeCutz_1`, `SnakeCutz_2`, ...).
- Duplicated artwork goes into a separate group called **Images** (`Image_1`, `Image_2`, ...).

---

## Notes / limitations

- Both scripts identify the cut shape geometrically (by counting anchor points), not by an "object type" — Illustrator doesn't have a distinct rectangle/ellipse object once something is drawn. A rounded-corner rectangle will **not** be picked up by QuikCutzGrid; an unrelated 4-point shape (like a diamond) could in theory be misidentified by SnakeCutz.
- Both dialogs always ask for measurements in **millimeters**, regardless of your document's ruler unit setting.
- Neither script includes a "rasterize duplicated artwork into one image" option — duplicated artwork is always left as separate objects in the Images group.
- These were written and checked carefully against Illustrator's scripting documentation but have not been extensively tested inside Illustrator itself. If something throws an error, note the exact message and what step you were on when it happened — it's usually a small, isolated fix.
