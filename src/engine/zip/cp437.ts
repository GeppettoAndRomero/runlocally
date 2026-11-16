// Unicode CP437 table version 2.00:
// https://www.unicode.org/Public/MAPPINGS/VENDORS/MICSFT/PC/CP437.TXT
// Low bytes 00–7F retain their code points, including controls (no decorative glyphs).
const HIGH =
  'ÇüéâäàåçêëèïîìÄÅ' +
  'ÉæÆôöòûùÿÖÜ¢£¥₧ƒ' +
  'áíóúñÑªº¿⌐¬½¼¡«»' +
  '░▒▓│┤╡╢╖╕╣║╗╝╜╛┐' +
  '└┴┬├─┼╞╟╚╔╩╦╠═╬╧' +
  '╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀' +
  'αßΓπΣσµτΦΘΩδ∞φε∩' +
  '≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

export function decodeCp437(bytes: Uint8Array): string {
  let name = '';
  for (const byte of bytes) name += byte < 0x80 ? String.fromCharCode(byte) : HIGH[byte - 0x80];
  return name;
}
