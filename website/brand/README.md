# WWA envelope seal (final)

Send to the embosser vendor: `embosser-order-package.zip` (artwork + order sheet) with the text in `EMAIL-TO-VENDOR.txt`. Fill in the ship-to address in the order sheet (edit `order-sheet.html`, re-print to PDF) or just paste it in the email.

- `wwa-seal-final.svg` / `.pdf`: vector, all text already outlines (no fonts needed). `wwa-seal-final-3000px.png`: bitmap, black on white.
- `make_seal.py` regenerates the SVG (needs `pip install fonttools`, Georgia Bold). Edit the wording or sizes there.
- Design: ruler-tick ring (an architect's scale), a floating shed roof over a "W" for Willard Williams. 1-5/8 in round; thinnest line about 0.4 mm, smallest letters about 2 mm.
- Do not use your official architect's seal for envelopes; that is a separate, regulated stamp.
- `old/` holds the first, rougher version.
