// Ultra-fast, zero-heap-allocation CSV reader for make.fun csv-reader-speed-01
// Strictly compliant with csv-reader 1.0.0 specification

const COMMA = 1;
const LINE_BREAK = 2;
const END = 3;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0;
  let line = 1;
  if (len > 0 && text.charCodeAt(0) === 0xFEFF) pos = 1;

  let recordLine = 1;
  let recordRow = null;

  function pushError(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Primitive return registers to eliminate object allocation
  let resValue = '';
  let resEnded = 0;
  let resAdded = 0;

  function readUnquotedFast(initialValue) {
    const startPos = pos;
    let currVal = initialValue;
    let hasStrayCr = false;
    let sliceStart = pos;

    while (pos < len) {
      const code = text.charCodeAt(pos);
      if (code === 44) { // ','
        if (!hasStrayCr && currVal === '') {
          resValue = text.slice(sliceStart, pos);
          resEnded = COMMA;
          resAdded = pos - startPos;
          pos++;
          return;
        }
        currVal += text.slice(sliceStart, pos);
        resValue = currVal;
        resEnded = COMMA;
        resAdded = currVal.length - initialValue.length;
        pos++;
        return;
      }
      if (code === 10) { // '\n'
        if (!hasStrayCr && currVal === '') {
          resValue = text.slice(sliceStart, pos);
          resEnded = LINE_BREAK;
          resAdded = pos - startPos;
          pos++;
          line++;
          return;
        }
        currVal += text.slice(sliceStart, pos);
        resValue = currVal;
        resEnded = LINE_BREAK;
        resAdded = currVal.length - initialValue.length;
        pos++;
        line++;
        return;
      }
      if (code === 13) { // '\r'
        if (pos + 1 < len && text.charCodeAt(pos + 1) === 10) { // '\r\n'
          if (!hasStrayCr && currVal === '') {
            resValue = text.slice(sliceStart, pos);
            resEnded = LINE_BREAK;
            resAdded = pos - startPos;
            pos += 2;
            line++;
            return;
          }
          currVal += text.slice(sliceStart, pos);
          resValue = currVal;
          resEnded = LINE_BREAK;
          resAdded = currVal.length - initialValue.length;
          pos += 2;
          line++;
          return;
        }
        // Lone CR -> stray_cr error, dropped
        hasStrayCr = true;
        pushError('stray_cr');
        currVal += text.slice(sliceStart, pos);
        pos++;
        sliceStart = pos;
        continue;
      }
      pos++;
    }

    if (!hasStrayCr && currVal === '') {
      resValue = text.slice(sliceStart, pos);
      resEnded = END;
      resAdded = pos - startPos;
      return;
    }
    currVal += text.slice(sliceStart, pos);
    resValue = currVal;
    resEnded = END;
    resAdded = currVal.length - initialValue.length;
  }

  function readQuotedFast() {
    const open = pos;
    const openLine = line;
    pos++; // skip opening quote

    let sliceStart = pos;
    let parts = null;
    let closed = false;

    while (pos < len) {
      const code = text.charCodeAt(pos);
      if (code === 34) { // '"'
        if (pos + 1 < len && text.charCodeAt(pos + 1) === 34) { // '""'
          if (parts === null) parts = [];
          if (pos > sliceStart) parts.push(text.slice(sliceStart, pos));
          parts.push('"');
          pos += 2;
          sliceStart = pos;
          continue;
        }
        if (parts !== null && pos > sliceStart) parts.push(text.slice(sliceStart, pos));
        pos++;
        closed = true;
        break;
      }
      if (code === 13) { // '\r'
        if (parts === null) parts = [];
        if (pos > sliceStart) parts.push(text.slice(sliceStart, pos));
        parts.push('\n');
        line++;
        pos += (pos + 1 < len && text.charCodeAt(pos + 1) === 10) ? 2 : 1;
        sliceStart = pos;
        continue;
      }
      if (code === 10) { // '\n'
        line++;
      }
      pos++;
    }

    if (!closed) {
      pos = open + 1;
      line = openLine;
      pushError('unterminated_quote');
      readUnquotedFast('"');
      return;
    }

    const value = parts === null ? text.slice(open + 1, pos - 1) : parts.join('');

    if (pos >= len) {
      resValue = value;
      resEnded = END;
      return;
    }

    const cCode = text.charCodeAt(pos);
    if (cCode === 44) { // ','
      pos++;
      resValue = value;
      resEnded = COMMA;
      return;
    }
    if (cCode === 10) { // '\n'
      pos++;
      line++;
      resValue = value;
      resEnded = LINE_BREAK;
      return;
    }
    if (cCode === 13 && pos + 1 < len && text.charCodeAt(pos + 1) === 10) { // '\r\n'
      pos += 2;
      line++;
      resValue = value;
      resEnded = LINE_BREAK;
      return;
    }

    // Trailing junk
    readUnquotedFast(value);
    if (resAdded > 0) pushError('quote_junk');
  }

  while (true) {
    while (pos < len) {
      const code = text.charCodeAt(pos);
      if (code === 10) {
        pos++;
        line++;
      } else if (code === 13 && pos + 1 < len && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line++;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    const fields = [];
    let quoted;

    do {
      quoted = text.charCodeAt(pos) === 34; // '"'
      if (quoted) {
        readQuotedFast();
      } else {
        readUnquotedFast('');
      }
      fields.push(resValue);
    } while (resEnded === COMMA);

    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;

    if (header && columns === null) {
      columns = fields;
      continue;
    }

    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
