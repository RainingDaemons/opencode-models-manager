// Generates the "Model Manager" pixel wordmark in opencode's ornate art style.
// Art rules extracted from opencode's logo-ornate.svg:
//   - 6px cell grid, glyphs 4 cells wide, body 5 cells tall (+1-2 overshoot rows)
//   - two-tone wordmark: first half / second half
//   - accent blocks ('d' cells) aligned to one horizontal band (rows 2-3),
//     filling the lower half of each letter's interior -> one continuous shadow line
import { writeFileSync } from "fs"

const CELL = 6
const GAP = 6
const TOP = 6
const SPACE_WIDTH = 2

const GLYPHS = {
  a: ["####", "#..#", "####", "#dd#", "#dd#"],
  d: ["..##", "####", "#dd#", "#dd#", "####"],
  e: ["####", "#..#", "####", "#ddd", "####"],
  g: ["####", "#..#", "#dd#", "#dd#", "####", "...#", "####"],
  l: ["###.", ".#..", ".#..", ".#dd", "####"],
  m: ["#####", "#.#.#", "#d#d#", "#d#d#", "#d#d#"],
  n: ["####", "#..#", "#dd#", "#dd#", "#dd#"],
  o: ["####", "#..#", "#dd#", "#dd#", "####"],
  r: ["####", "#..#", "#dd#", "#d..", "#d.."],
  s: ["####", "#...", "####", "ddd#", "####"],
}

const WORD = "models manager"

function glyphWidth(char) {
  if (char === " ") return SPACE_WIDTH
  return GLYPHS[char][0].length
}

function render(main, accent) {
  const parts = []
  let x = 0
  for (let i = 0; i < WORD.length; i++) {
    const char = WORD[i]
    if (char === " ") {
      x += SPACE_WIDTH * CELL + GAP
      continue
    }
    const rows = GLYPHS[char]
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        const cell = rows[r][c]
        if (cell === ".") continue
        parts.push(
          `<rect x="${x + c * CELL}" y="${TOP + r * CELL}" width="${CELL}" height="${CELL}" fill="${cell === "d" ? accent : main}"/>`,
        )
      }
    }
    x += glyphWidth(char) * CELL + GAP
  }
  const width = x - GAP
  const height = TOP + Math.max(...Object.values(GLYPHS).map((g) => g.length)) * CELL
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg">\n${parts.join("\n")}\n</svg>\n`
}

writeFileSync(new URL("../assets/logo-dark.svg", import.meta.url), render("#F1ECEC", "#4B4646"))
writeFileSync(new URL("../assets/logo-light.svg", import.meta.url), render("#211E1E", "#CFCECD"))
console.log("written")
