/* ============================================================================
 * TiznetVPN Shop Bot — فروشگاه تیزنت VPN، سازگار با Hiddify Manager v14
 * اجرا: Cloudflare Workers یا آداپتور self-hosted روی Node.js + SQLite سازگار با KV
 * پنل: Hiddify Manager v14 — API v2
 *   POST   {api_base}/api/v2/admin/user/          ساخت یوزر
 *   GET    {api_base}/api/v2/admin/user/{uuid}/   مشاهده یوزر
 *   PATCH  {api_base}/api/v2/admin/user/{uuid}/   تمدید/ویرایش
 *   DELETE {api_base}/api/v2/admin/user/{uuid}/   حذف
 *   GET    {api_base}/api/v2/admin/me/            تست اتصال
 *   هدر احراز هویت: Hiddify-API-Key: <admin uuid>
 * منطق فروشگاه مستقل از میزبان است؛ server/server.mjs روی Ubuntu،
 * KV را با SQLite و binding فایل‌ها را از پوشه public ارائه می‌کند.
 * ========================================================================== */

/* Vendored QR encoder; original MIT notice: src/vendor/QRCODE-MIT.txt */
//---------------------------------------------------------------------
//
// QR Code Generator for JavaScript
//
// Copyright (c) 2009 Kazuhiko Arase
//
// URL: http://www.d-project.com/
//
// Licensed under the MIT license:
//  http://www.opensource.org/licenses/mit-license.php
//
// The word 'QR Code' is registered trademark of
// DENSO WAVE INCORPORATED
//  http://www.denso-wave.com/qrcode/faqpatent-e.html
//
//---------------------------------------------------------------------

var qrcode = function() {

  //---------------------------------------------------------------------
  // qrcode
  //---------------------------------------------------------------------

  /**
   * qrcode
   * @param typeNumber 1 to 40
   * @param errorCorrectionLevel 'L','M','Q','H'
   */
  var qrcode = function(typeNumber, errorCorrectionLevel) {

    var PAD0 = 0xEC;
    var PAD1 = 0x11;

    var _typeNumber = typeNumber;
    var _errorCorrectionLevel = QRErrorCorrectionLevel[errorCorrectionLevel];
    var _modules = null;
    var _moduleCount = 0;
    var _dataCache = null;
    var _dataList = [];

    var _this = {};

    var makeImpl = function(test, maskPattern) {

      _moduleCount = _typeNumber * 4 + 17;
      _modules = function(moduleCount) {
        var modules = new Array(moduleCount);
        for (var row = 0; row < moduleCount; row += 1) {
          modules[row] = new Array(moduleCount);
          for (var col = 0; col < moduleCount; col += 1) {
            modules[row][col] = null;
          }
        }
        return modules;
      }(_moduleCount);

      setupPositionProbePattern(0, 0);
      setupPositionProbePattern(_moduleCount - 7, 0);
      setupPositionProbePattern(0, _moduleCount - 7);
      setupPositionAdjustPattern();
      setupTimingPattern();
      setupTypeInfo(test, maskPattern);

      if (_typeNumber >= 7) {
        setupTypeNumber(test);
      }

      if (_dataCache == null) {
        _dataCache = createData(_typeNumber, _errorCorrectionLevel, _dataList);
      }

      mapData(_dataCache, maskPattern);
    };

    var setupPositionProbePattern = function(row, col) {

      for (var r = -1; r <= 7; r += 1) {

        if (row + r <= -1 || _moduleCount <= row + r) continue;

        for (var c = -1; c <= 7; c += 1) {

          if (col + c <= -1 || _moduleCount <= col + c) continue;

          if ( (0 <= r && r <= 6 && (c == 0 || c == 6) )
              || (0 <= c && c <= 6 && (r == 0 || r == 6) )
              || (2 <= r && r <= 4 && 2 <= c && c <= 4) ) {
            _modules[row + r][col + c] = true;
          } else {
            _modules[row + r][col + c] = false;
          }
        }
      }
    };

    var getBestMaskPattern = function() {

      var minLostPoint = 0;
      var pattern = 0;

      for (var i = 0; i < 8; i += 1) {

        makeImpl(true, i);

        var lostPoint = QRUtil.getLostPoint(_this);

        if (i == 0 || minLostPoint > lostPoint) {
          minLostPoint = lostPoint;
          pattern = i;
        }
      }

      return pattern;
    };

    var setupTimingPattern = function() {

      for (var r = 8; r < _moduleCount - 8; r += 1) {
        if (_modules[r][6] != null) {
          continue;
        }
        _modules[r][6] = (r % 2 == 0);
      }

      for (var c = 8; c < _moduleCount - 8; c += 1) {
        if (_modules[6][c] != null) {
          continue;
        }
        _modules[6][c] = (c % 2 == 0);
      }
    };

    var setupPositionAdjustPattern = function() {

      var pos = QRUtil.getPatternPosition(_typeNumber);

      for (var i = 0; i < pos.length; i += 1) {

        for (var j = 0; j < pos.length; j += 1) {

          var row = pos[i];
          var col = pos[j];

          if (_modules[row][col] != null) {
            continue;
          }

          for (var r = -2; r <= 2; r += 1) {

            for (var c = -2; c <= 2; c += 1) {

              if (r == -2 || r == 2 || c == -2 || c == 2
                  || (r == 0 && c == 0) ) {
                _modules[row + r][col + c] = true;
              } else {
                _modules[row + r][col + c] = false;
              }
            }
          }
        }
      }
    };

    var setupTypeNumber = function(test) {

      var bits = QRUtil.getBCHTypeNumber(_typeNumber);

      for (var i = 0; i < 18; i += 1) {
        var mod = (!test && ( (bits >> i) & 1) == 1);
        _modules[Math.floor(i / 3)][i % 3 + _moduleCount - 8 - 3] = mod;
      }

      for (var i = 0; i < 18; i += 1) {
        var mod = (!test && ( (bits >> i) & 1) == 1);
        _modules[i % 3 + _moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
      }
    };

    var setupTypeInfo = function(test, maskPattern) {

      var data = (_errorCorrectionLevel << 3) | maskPattern;
      var bits = QRUtil.getBCHTypeInfo(data);

      // vertical
      for (var i = 0; i < 15; i += 1) {

        var mod = (!test && ( (bits >> i) & 1) == 1);

        if (i < 6) {
          _modules[i][8] = mod;
        } else if (i < 8) {
          _modules[i + 1][8] = mod;
        } else {
          _modules[_moduleCount - 15 + i][8] = mod;
        }
      }

      // horizontal
      for (var i = 0; i < 15; i += 1) {

        var mod = (!test && ( (bits >> i) & 1) == 1);

        if (i < 8) {
          _modules[8][_moduleCount - i - 1] = mod;
        } else if (i < 9) {
          _modules[8][15 - i - 1 + 1] = mod;
        } else {
          _modules[8][15 - i - 1] = mod;
        }
      }

      // fixed module
      _modules[_moduleCount - 8][8] = (!test);
    };

    var mapData = function(data, maskPattern) {

      var inc = -1;
      var row = _moduleCount - 1;
      var bitIndex = 7;
      var byteIndex = 0;
      var maskFunc = QRUtil.getMaskFunction(maskPattern);

      for (var col = _moduleCount - 1; col > 0; col -= 2) {

        if (col == 6) col -= 1;

        while (true) {

          for (var c = 0; c < 2; c += 1) {

            if (_modules[row][col - c] == null) {

              var dark = false;

              if (byteIndex < data.length) {
                dark = ( ( (data[byteIndex] >>> bitIndex) & 1) == 1);
              }

              var mask = maskFunc(row, col - c);

              if (mask) {
                dark = !dark;
              }

              _modules[row][col - c] = dark;
              bitIndex -= 1;

              if (bitIndex == -1) {
                byteIndex += 1;
                bitIndex = 7;
              }
            }
          }

          row += inc;

          if (row < 0 || _moduleCount <= row) {
            row -= inc;
            inc = -inc;
            break;
          }
        }
      }
    };

    var createBytes = function(buffer, rsBlocks) {

      var offset = 0;

      var maxDcCount = 0;
      var maxEcCount = 0;

      var dcdata = new Array(rsBlocks.length);
      var ecdata = new Array(rsBlocks.length);

      for (var r = 0; r < rsBlocks.length; r += 1) {

        var dcCount = rsBlocks[r].dataCount;
        var ecCount = rsBlocks[r].totalCount - dcCount;

        maxDcCount = Math.max(maxDcCount, dcCount);
        maxEcCount = Math.max(maxEcCount, ecCount);

        dcdata[r] = new Array(dcCount);

        for (var i = 0; i < dcdata[r].length; i += 1) {
          dcdata[r][i] = 0xff & buffer.getBuffer()[i + offset];
        }
        offset += dcCount;

        var rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
        var rawPoly = qrPolynomial(dcdata[r], rsPoly.getLength() - 1);

        var modPoly = rawPoly.mod(rsPoly);
        ecdata[r] = new Array(rsPoly.getLength() - 1);
        for (var i = 0; i < ecdata[r].length; i += 1) {
          var modIndex = i + modPoly.getLength() - ecdata[r].length;
          ecdata[r][i] = (modIndex >= 0)? modPoly.getAt(modIndex) : 0;
        }
      }

      var totalCodeCount = 0;
      for (var i = 0; i < rsBlocks.length; i += 1) {
        totalCodeCount += rsBlocks[i].totalCount;
      }

      var data = new Array(totalCodeCount);
      var index = 0;

      for (var i = 0; i < maxDcCount; i += 1) {
        for (var r = 0; r < rsBlocks.length; r += 1) {
          if (i < dcdata[r].length) {
            data[index] = dcdata[r][i];
            index += 1;
          }
        }
      }

      for (var i = 0; i < maxEcCount; i += 1) {
        for (var r = 0; r < rsBlocks.length; r += 1) {
          if (i < ecdata[r].length) {
            data[index] = ecdata[r][i];
            index += 1;
          }
        }
      }

      return data;
    };

    var createData = function(typeNumber, errorCorrectionLevel, dataList) {

      var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectionLevel);

      var buffer = qrBitBuffer();

      for (var i = 0; i < dataList.length; i += 1) {
        var data = dataList[i];
        buffer.put(data.getMode(), 4);
        buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber) );
        data.write(buffer);
      }

      // calc num max data.
      var totalDataCount = 0;
      for (var i = 0; i < rsBlocks.length; i += 1) {
        totalDataCount += rsBlocks[i].dataCount;
      }

      if (buffer.getLengthInBits() > totalDataCount * 8) {
        throw 'code length overflow. ('
          + buffer.getLengthInBits()
          + '>'
          + totalDataCount * 8
          + ')';
      }

      // end code
      if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) {
        buffer.put(0, 4);
      }

      // padding
      while (buffer.getLengthInBits() % 8 != 0) {
        buffer.putBit(false);
      }

      // padding
      while (true) {

        if (buffer.getLengthInBits() >= totalDataCount * 8) {
          break;
        }
        buffer.put(PAD0, 8);

        if (buffer.getLengthInBits() >= totalDataCount * 8) {
          break;
        }
        buffer.put(PAD1, 8);
      }

      return createBytes(buffer, rsBlocks);
    };

    _this.addData = function(data, mode) {

      mode = mode || 'Byte';

      var newData = null;

      switch(mode) {
      case 'Numeric' :
        newData = qrNumber(data);
        break;
      case 'Alphanumeric' :
        newData = qrAlphaNum(data);
        break;
      case 'Byte' :
        newData = qr8BitByte(data);
        break;
      case 'Kanji' :
        newData = qrKanji(data);
        break;
      default :
        throw 'mode:' + mode;
      }

      _dataList.push(newData);
      _dataCache = null;
    };

    _this.isDark = function(row, col) {
      if (row < 0 || _moduleCount <= row || col < 0 || _moduleCount <= col) {
        throw row + ',' + col;
      }
      return _modules[row][col];
    };

    _this.getModuleCount = function() {
      return _moduleCount;
    };

    _this.make = function() {
      if (_typeNumber < 1) {
        var typeNumber = 1;

        for (; typeNumber < 40; typeNumber++) {
          var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, _errorCorrectionLevel);
          var buffer = qrBitBuffer();

          for (var i = 0; i < _dataList.length; i++) {
            var data = _dataList[i];
            buffer.put(data.getMode(), 4);
            buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber) );
            data.write(buffer);
          }

          var totalDataCount = 0;
          for (var i = 0; i < rsBlocks.length; i++) {
            totalDataCount += rsBlocks[i].dataCount;
          }

          if (buffer.getLengthInBits() <= totalDataCount * 8) {
            break;
          }
        }

        _typeNumber = typeNumber;
      }

      makeImpl(false, getBestMaskPattern() );
    };

    _this.createTableTag = function(cellSize, margin) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var qrHtml = '';

      qrHtml += '<table style="';
      qrHtml += ' border-width: 0px; border-style: none;';
      qrHtml += ' border-collapse: collapse;';
      qrHtml += ' padding: 0px; margin: ' + margin + 'px;';
      qrHtml += '">';
      qrHtml += '<tbody>';

      for (var r = 0; r < _this.getModuleCount(); r += 1) {

        qrHtml += '<tr>';

        for (var c = 0; c < _this.getModuleCount(); c += 1) {
          qrHtml += '<td style="';
          qrHtml += ' border-width: 0px; border-style: none;';
          qrHtml += ' border-collapse: collapse;';
          qrHtml += ' padding: 0px; margin: 0px;';
          qrHtml += ' width: ' + cellSize + 'px;';
          qrHtml += ' height: ' + cellSize + 'px;';
          qrHtml += ' background-color: ';
          qrHtml += _this.isDark(r, c)? '#000000' : '#ffffff';
          qrHtml += ';';
          qrHtml += '"/>';
        }

        qrHtml += '</tr>';
      }

      qrHtml += '</tbody>';
      qrHtml += '</table>';

      return qrHtml;
    };

    _this.createSvgTag = function(cellSize, margin, alt, title) {

      var opts = {};
      if (typeof arguments[0] == 'object') {
        // Called by options.
        opts = arguments[0];
        // overwrite cellSize and margin.
        cellSize = opts.cellSize;
        margin = opts.margin;
        alt = opts.alt;
        title = opts.title;
      }

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      // Compose alt property surrogate
      alt = (typeof alt === 'string') ? {text: alt} : alt || {};
      alt.text = alt.text || null;
      alt.id = (alt.text) ? alt.id || 'qrcode-description' : null;

      // Compose title property surrogate
      title = (typeof title === 'string') ? {text: title} : title || {};
      title.text = title.text || null;
      title.id = (title.text) ? title.id || 'qrcode-title' : null;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var c, mc, r, mr, qrSvg='', rect;

      rect = 'l' + cellSize + ',0 0,' + cellSize +
        ' -' + cellSize + ',0 0,-' + cellSize + 'z ';

      qrSvg += '<svg version="1.1" xmlns="http://www.w3.org/2000/svg"';
      qrSvg += !opts.scalable ? ' width="' + size + 'px" height="' + size + 'px"' : '';
      qrSvg += ' viewBox="0 0 ' + size + ' ' + size + '" ';
      qrSvg += ' preserveAspectRatio="xMinYMin meet"';
      qrSvg += (title.text || alt.text) ? ' role="img" aria-labelledby="' +
          escapeXml([title.id, alt.id].join(' ').trim() ) + '"' : '';
      qrSvg += '>';
      qrSvg += (title.text) ? '<title id="' + escapeXml(title.id) + '">' +
          escapeXml(title.text) + '</title>' : '';
      qrSvg += (alt.text) ? '<description id="' + escapeXml(alt.id) + '">' +
          escapeXml(alt.text) + '</description>' : '';
      qrSvg += '<rect width="100%" height="100%" fill="white" cx="0" cy="0"/>';
      qrSvg += '<path d="';

      for (r = 0; r < _this.getModuleCount(); r += 1) {
        mr = r * cellSize + margin;
        for (c = 0; c < _this.getModuleCount(); c += 1) {
          if (_this.isDark(r, c) ) {
            mc = c*cellSize+margin;
            qrSvg += 'M' + mc + ',' + mr + rect;
          }
        }
      }

      qrSvg += '" stroke="transparent" fill="black"/>';
      qrSvg += '</svg>';

      return qrSvg;
    };

    _this.createDataURL = function(cellSize, margin) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      return createDataURL(size, size, function(x, y) {
        if (min <= x && x < max && min <= y && y < max) {
          var c = Math.floor( (x - min) / cellSize);
          var r = Math.floor( (y - min) / cellSize);
          return _this.isDark(r, c)? 0 : 1;
        } else {
          return 1;
        }
      } );
    };

    _this.createImgTag = function(cellSize, margin, alt) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;

      var img = '';
      img += '<img';
      img += '\u0020src="';
      img += _this.createDataURL(cellSize, margin);
      img += '"';
      img += '\u0020width="';
      img += size;
      img += '"';
      img += '\u0020height="';
      img += size;
      img += '"';
      if (alt) {
        img += '\u0020alt="';
        img += escapeXml(alt);
        img += '"';
      }
      img += '/>';

      return img;
    };

    var escapeXml = function(s) {
      var escaped = '';
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charAt(i);
        switch(c) {
        case '<': escaped += '&lt;'; break;
        case '>': escaped += '&gt;'; break;
        case '&': escaped += '&amp;'; break;
        case '"': escaped += '&quot;'; break;
        default : escaped += c; break;
        }
      }
      return escaped;
    };

    var _createHalfASCII = function(margin) {
      var cellSize = 1;
      margin = (typeof margin == 'undefined')? cellSize * 2 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      var y, x, r1, r2, p;

      var blocks = {
        '██': '█',
        '█ ': '▀',
        ' █': '▄',
        '  ': ' '
      };

      var blocksLastLineNoMargin = {
        '██': '▀',
        '█ ': '▀',
        ' █': ' ',
        '  ': ' '
      };

      var ascii = '';
      for (y = 0; y < size; y += 2) {
        r1 = Math.floor((y - min) / cellSize);
        r2 = Math.floor((y + 1 - min) / cellSize);
        for (x = 0; x < size; x += 1) {
          p = '█';

          if (min <= x && x < max && min <= y && y < max && _this.isDark(r1, Math.floor((x - min) / cellSize))) {
            p = ' ';
          }

          if (min <= x && x < max && min <= y+1 && y+1 < max && _this.isDark(r2, Math.floor((x - min) / cellSize))) {
            p += ' ';
          }
          else {
            p += '█';
          }

          // Output 2 characters per pixel, to create full square. 1 character per pixels gives only half width of square.
          ascii += (margin < 1 && y+1 >= max) ? blocksLastLineNoMargin[p] : blocks[p];
        }

        ascii += '\n';
      }

      if (size % 2 && margin > 0) {
        return ascii.substring(0, ascii.length - size - 1) + Array(size+1).join('▀');
      }

      return ascii.substring(0, ascii.length-1);
    };

    _this.createASCII = function(cellSize, margin) {
      cellSize = cellSize || 1;

      if (cellSize < 2) {
        return _createHalfASCII(margin);
      }

      cellSize -= 1;
      margin = (typeof margin == 'undefined')? cellSize * 2 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      var y, x, r, p;

      var white = Array(cellSize+1).join('██');
      var black = Array(cellSize+1).join('  ');

      var ascii = '';
      var line = '';
      for (y = 0; y < size; y += 1) {
        r = Math.floor( (y - min) / cellSize);
        line = '';
        for (x = 0; x < size; x += 1) {
          p = 1;

          if (min <= x && x < max && min <= y && y < max && _this.isDark(r, Math.floor((x - min) / cellSize))) {
            p = 0;
          }

          // Output 2 characters per pixel, to create full square. 1 character per pixels gives only half width of square.
          line += p ? white : black;
        }

        for (r = 0; r < cellSize; r += 1) {
          ascii += line + '\n';
        }
      }

      return ascii.substring(0, ascii.length-1);
    };

    _this.renderTo2dContext = function(context, cellSize) {
      cellSize = cellSize || 2;
      var length = _this.getModuleCount();
      for (var row = 0; row < length; row++) {
        for (var col = 0; col < length; col++) {
          context.fillStyle = _this.isDark(row, col) ? 'black' : 'white';
          context.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
        }
      }
    }

    return _this;
  };

  //---------------------------------------------------------------------
  // qrcode.stringToBytes
  //---------------------------------------------------------------------

  qrcode.stringToBytesFuncs = {
    'default' : function(s) {
      var bytes = [];
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charCodeAt(i);
        bytes.push(c & 0xff);
      }
      return bytes;
    }
  };

  qrcode.stringToBytes = qrcode.stringToBytesFuncs['default'];

  //---------------------------------------------------------------------
  // qrcode.createStringToBytes
  //---------------------------------------------------------------------

  /**
   * @param unicodeData base64 string of byte array.
   * [16bit Unicode],[16bit Bytes], ...
   * @param numChars
   */
  qrcode.createStringToBytes = function(unicodeData, numChars) {

    // create conversion map.

    var unicodeMap = function() {

      var bin = base64DecodeInputStream(unicodeData);
      var read = function() {
        var b = bin.read();
        if (b == -1) throw 'eof';
        return b;
      };

      var count = 0;
      var unicodeMap = {};
      while (true) {
        var b0 = bin.read();
        if (b0 == -1) break;
        var b1 = read();
        var b2 = read();
        var b3 = read();
        var k = String.fromCharCode( (b0 << 8) | b1);
        var v = (b2 << 8) | b3;
        unicodeMap[k] = v;
        count += 1;
      }
      if (count != numChars) {
        throw count + ' != ' + numChars;
      }

      return unicodeMap;
    }();

    var unknownChar = '?'.charCodeAt(0);

    return function(s) {
      var bytes = [];
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charCodeAt(i);
        if (c < 128) {
          bytes.push(c);
        } else {
          var b = unicodeMap[s.charAt(i)];
          if (typeof b == 'number') {
            if ( (b & 0xff) == b) {
              // 1byte
              bytes.push(b);
            } else {
              // 2bytes
              bytes.push(b >>> 8);
              bytes.push(b & 0xff);
            }
          } else {
            bytes.push(unknownChar);
          }
        }
      }
      return bytes;
    };
  };

  //---------------------------------------------------------------------
  // QRMode
  //---------------------------------------------------------------------

  var QRMode = {
    MODE_NUMBER :    1 << 0,
    MODE_ALPHA_NUM : 1 << 1,
    MODE_8BIT_BYTE : 1 << 2,
    MODE_KANJI :     1 << 3
  };

  //---------------------------------------------------------------------
  // QRErrorCorrectionLevel
  //---------------------------------------------------------------------

  var QRErrorCorrectionLevel = {
    L : 1,
    M : 0,
    Q : 3,
    H : 2
  };

  //---------------------------------------------------------------------
  // QRMaskPattern
  //---------------------------------------------------------------------

  var QRMaskPattern = {
    PATTERN000 : 0,
    PATTERN001 : 1,
    PATTERN010 : 2,
    PATTERN011 : 3,
    PATTERN100 : 4,
    PATTERN101 : 5,
    PATTERN110 : 6,
    PATTERN111 : 7
  };

  //---------------------------------------------------------------------
  // QRUtil
  //---------------------------------------------------------------------

  var QRUtil = function() {

    var PATTERN_POSITION_TABLE = [
      [],
      [6, 18],
      [6, 22],
      [6, 26],
      [6, 30],
      [6, 34],
      [6, 22, 38],
      [6, 24, 42],
      [6, 26, 46],
      [6, 28, 50],
      [6, 30, 54],
      [6, 32, 58],
      [6, 34, 62],
      [6, 26, 46, 66],
      [6, 26, 48, 70],
      [6, 26, 50, 74],
      [6, 30, 54, 78],
      [6, 30, 56, 82],
      [6, 30, 58, 86],
      [6, 34, 62, 90],
      [6, 28, 50, 72, 94],
      [6, 26, 50, 74, 98],
      [6, 30, 54, 78, 102],
      [6, 28, 54, 80, 106],
      [6, 32, 58, 84, 110],
      [6, 30, 58, 86, 114],
      [6, 34, 62, 90, 118],
      [6, 26, 50, 74, 98, 122],
      [6, 30, 54, 78, 102, 126],
      [6, 26, 52, 78, 104, 130],
      [6, 30, 56, 82, 108, 134],
      [6, 34, 60, 86, 112, 138],
      [6, 30, 58, 86, 114, 142],
      [6, 34, 62, 90, 118, 146],
      [6, 30, 54, 78, 102, 126, 150],
      [6, 24, 50, 76, 102, 128, 154],
      [6, 28, 54, 80, 106, 132, 158],
      [6, 32, 58, 84, 110, 136, 162],
      [6, 26, 54, 82, 110, 138, 166],
      [6, 30, 58, 86, 114, 142, 170]
    ];
    var G15 = (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0);
    var G18 = (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0);
    var G15_MASK = (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1);

    var _this = {};

    var getBCHDigit = function(data) {
      var digit = 0;
      while (data != 0) {
        digit += 1;
        data >>>= 1;
      }
      return digit;
    };

    _this.getBCHTypeInfo = function(data) {
      var d = data << 10;
      while (getBCHDigit(d) - getBCHDigit(G15) >= 0) {
        d ^= (G15 << (getBCHDigit(d) - getBCHDigit(G15) ) );
      }
      return ( (data << 10) | d) ^ G15_MASK;
    };

    _this.getBCHTypeNumber = function(data) {
      var d = data << 12;
      while (getBCHDigit(d) - getBCHDigit(G18) >= 0) {
        d ^= (G18 << (getBCHDigit(d) - getBCHDigit(G18) ) );
      }
      return (data << 12) | d;
    };

    _this.getPatternPosition = function(typeNumber) {
      return PATTERN_POSITION_TABLE[typeNumber - 1];
    };

    _this.getMaskFunction = function(maskPattern) {

      switch (maskPattern) {

      case QRMaskPattern.PATTERN000 :
        return function(i, j) { return (i + j) % 2 == 0; };
      case QRMaskPattern.PATTERN001 :
        return function(i, j) { return i % 2 == 0; };
      case QRMaskPattern.PATTERN010 :
        return function(i, j) { return j % 3 == 0; };
      case QRMaskPattern.PATTERN011 :
        return function(i, j) { return (i + j) % 3 == 0; };
      case QRMaskPattern.PATTERN100 :
        return function(i, j) { return (Math.floor(i / 2) + Math.floor(j / 3) ) % 2 == 0; };
      case QRMaskPattern.PATTERN101 :
        return function(i, j) { return (i * j) % 2 + (i * j) % 3 == 0; };
      case QRMaskPattern.PATTERN110 :
        return function(i, j) { return ( (i * j) % 2 + (i * j) % 3) % 2 == 0; };
      case QRMaskPattern.PATTERN111 :
        return function(i, j) { return ( (i * j) % 3 + (i + j) % 2) % 2 == 0; };

      default :
        throw 'bad maskPattern:' + maskPattern;
      }
    };

    _this.getErrorCorrectPolynomial = function(errorCorrectLength) {
      var a = qrPolynomial([1], 0);
      for (var i = 0; i < errorCorrectLength; i += 1) {
        a = a.multiply(qrPolynomial([1, QRMath.gexp(i)], 0) );
      }
      return a;
    };

    _this.getLengthInBits = function(mode, type) {

      if (1 <= type && type < 10) {

        // 1 - 9

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 10;
        case QRMode.MODE_ALPHA_NUM : return 9;
        case QRMode.MODE_8BIT_BYTE : return 8;
        case QRMode.MODE_KANJI     : return 8;
        default :
          throw 'mode:' + mode;
        }

      } else if (type < 27) {

        // 10 - 26

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 12;
        case QRMode.MODE_ALPHA_NUM : return 11;
        case QRMode.MODE_8BIT_BYTE : return 16;
        case QRMode.MODE_KANJI     : return 10;
        default :
          throw 'mode:' + mode;
        }

      } else if (type < 41) {

        // 27 - 40

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 14;
        case QRMode.MODE_ALPHA_NUM : return 13;
        case QRMode.MODE_8BIT_BYTE : return 16;
        case QRMode.MODE_KANJI     : return 12;
        default :
          throw 'mode:' + mode;
        }

      } else {
        throw 'type:' + type;
      }
    };

    _this.getLostPoint = function(qrcode) {

      var moduleCount = qrcode.getModuleCount();

      var lostPoint = 0;

      // LEVEL1

      for (var row = 0; row < moduleCount; row += 1) {
        for (var col = 0; col < moduleCount; col += 1) {

          var sameCount = 0;
          var dark = qrcode.isDark(row, col);

          for (var r = -1; r <= 1; r += 1) {

            if (row + r < 0 || moduleCount <= row + r) {
              continue;
            }

            for (var c = -1; c <= 1; c += 1) {

              if (col + c < 0 || moduleCount <= col + c) {
                continue;
              }

              if (r == 0 && c == 0) {
                continue;
              }

              if (dark == qrcode.isDark(row + r, col + c) ) {
                sameCount += 1;
              }
            }
          }

          if (sameCount > 5) {
            lostPoint += (3 + sameCount - 5);
          }
        }
      };

      // LEVEL2

      for (var row = 0; row < moduleCount - 1; row += 1) {
        for (var col = 0; col < moduleCount - 1; col += 1) {
          var count = 0;
          if (qrcode.isDark(row, col) ) count += 1;
          if (qrcode.isDark(row + 1, col) ) count += 1;
          if (qrcode.isDark(row, col + 1) ) count += 1;
          if (qrcode.isDark(row + 1, col + 1) ) count += 1;
          if (count == 0 || count == 4) {
            lostPoint += 3;
          }
        }
      }

      // LEVEL3

      for (var row = 0; row < moduleCount; row += 1) {
        for (var col = 0; col < moduleCount - 6; col += 1) {
          if (qrcode.isDark(row, col)
              && !qrcode.isDark(row, col + 1)
              &&  qrcode.isDark(row, col + 2)
              &&  qrcode.isDark(row, col + 3)
              &&  qrcode.isDark(row, col + 4)
              && !qrcode.isDark(row, col + 5)
              &&  qrcode.isDark(row, col + 6) ) {
            lostPoint += 40;
          }
        }
      }

      for (var col = 0; col < moduleCount; col += 1) {
        for (var row = 0; row < moduleCount - 6; row += 1) {
          if (qrcode.isDark(row, col)
              && !qrcode.isDark(row + 1, col)
              &&  qrcode.isDark(row + 2, col)
              &&  qrcode.isDark(row + 3, col)
              &&  qrcode.isDark(row + 4, col)
              && !qrcode.isDark(row + 5, col)
              &&  qrcode.isDark(row + 6, col) ) {
            lostPoint += 40;
          }
        }
      }

      // LEVEL4

      var darkCount = 0;

      for (var col = 0; col < moduleCount; col += 1) {
        for (var row = 0; row < moduleCount; row += 1) {
          if (qrcode.isDark(row, col) ) {
            darkCount += 1;
          }
        }
      }

      var ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
      lostPoint += ratio * 10;

      return lostPoint;
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // QRMath
  //---------------------------------------------------------------------

  var QRMath = function() {

    var EXP_TABLE = new Array(256);
    var LOG_TABLE = new Array(256);

    // initialize tables
    for (var i = 0; i < 8; i += 1) {
      EXP_TABLE[i] = 1 << i;
    }
    for (var i = 8; i < 256; i += 1) {
      EXP_TABLE[i] = EXP_TABLE[i - 4]
        ^ EXP_TABLE[i - 5]
        ^ EXP_TABLE[i - 6]
        ^ EXP_TABLE[i - 8];
    }
    for (var i = 0; i < 255; i += 1) {
      LOG_TABLE[EXP_TABLE[i] ] = i;
    }

    var _this = {};

    _this.glog = function(n) {

      if (n < 1) {
        throw 'glog(' + n + ')';
      }

      return LOG_TABLE[n];
    };

    _this.gexp = function(n) {

      while (n < 0) {
        n += 255;
      }

      while (n >= 256) {
        n -= 255;
      }

      return EXP_TABLE[n];
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // qrPolynomial
  //---------------------------------------------------------------------

  function qrPolynomial(num, shift) {

    if (typeof num.length == 'undefined') {
      throw num.length + '/' + shift;
    }

    var _num = function() {
      var offset = 0;
      while (offset < num.length && num[offset] == 0) {
        offset += 1;
      }
      var _num = new Array(num.length - offset + shift);
      for (var i = 0; i < num.length - offset; i += 1) {
        _num[i] = num[i + offset];
      }
      return _num;
    }();

    var _this = {};

    _this.getAt = function(index) {
      return _num[index];
    };

    _this.getLength = function() {
      return _num.length;
    };

    _this.multiply = function(e) {

      var num = new Array(_this.getLength() + e.getLength() - 1);

      for (var i = 0; i < _this.getLength(); i += 1) {
        for (var j = 0; j < e.getLength(); j += 1) {
          num[i + j] ^= QRMath.gexp(QRMath.glog(_this.getAt(i) ) + QRMath.glog(e.getAt(j) ) );
        }
      }

      return qrPolynomial(num, 0);
    };

    _this.mod = function(e) {

      if (_this.getLength() - e.getLength() < 0) {
        return _this;
      }

      var ratio = QRMath.glog(_this.getAt(0) ) - QRMath.glog(e.getAt(0) );

      var num = new Array(_this.getLength() );
      for (var i = 0; i < _this.getLength(); i += 1) {
        num[i] = _this.getAt(i);
      }

      for (var i = 0; i < e.getLength(); i += 1) {
        num[i] ^= QRMath.gexp(QRMath.glog(e.getAt(i) ) + ratio);
      }

      // recursive call
      return qrPolynomial(num, 0).mod(e);
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // QRRSBlock
  //---------------------------------------------------------------------

  var QRRSBlock = function() {

    var RS_BLOCK_TABLE = [

      // L
      // M
      // Q
      // H

      // 1
      [1, 26, 19],
      [1, 26, 16],
      [1, 26, 13],
      [1, 26, 9],

      // 2
      [1, 44, 34],
      [1, 44, 28],
      [1, 44, 22],
      [1, 44, 16],

      // 3
      [1, 70, 55],
      [1, 70, 44],
      [2, 35, 17],
      [2, 35, 13],

      // 4
      [1, 100, 80],
      [2, 50, 32],
      [2, 50, 24],
      [4, 25, 9],

      // 5
      [1, 134, 108],
      [2, 67, 43],
      [2, 33, 15, 2, 34, 16],
      [2, 33, 11, 2, 34, 12],

      // 6
      [2, 86, 68],
      [4, 43, 27],
      [4, 43, 19],
      [4, 43, 15],

      // 7
      [2, 98, 78],
      [4, 49, 31],
      [2, 32, 14, 4, 33, 15],
      [4, 39, 13, 1, 40, 14],

      // 8
      [2, 121, 97],
      [2, 60, 38, 2, 61, 39],
      [4, 40, 18, 2, 41, 19],
      [4, 40, 14, 2, 41, 15],

      // 9
      [2, 146, 116],
      [3, 58, 36, 2, 59, 37],
      [4, 36, 16, 4, 37, 17],
      [4, 36, 12, 4, 37, 13],

      // 10
      [2, 86, 68, 2, 87, 69],
      [4, 69, 43, 1, 70, 44],
      [6, 43, 19, 2, 44, 20],
      [6, 43, 15, 2, 44, 16],

      // 11
      [4, 101, 81],
      [1, 80, 50, 4, 81, 51],
      [4, 50, 22, 4, 51, 23],
      [3, 36, 12, 8, 37, 13],

      // 12
      [2, 116, 92, 2, 117, 93],
      [6, 58, 36, 2, 59, 37],
      [4, 46, 20, 6, 47, 21],
      [7, 42, 14, 4, 43, 15],

      // 13
      [4, 133, 107],
      [8, 59, 37, 1, 60, 38],
      [8, 44, 20, 4, 45, 21],
      [12, 33, 11, 4, 34, 12],

      // 14
      [3, 145, 115, 1, 146, 116],
      [4, 64, 40, 5, 65, 41],
      [11, 36, 16, 5, 37, 17],
      [11, 36, 12, 5, 37, 13],

      // 15
      [5, 109, 87, 1, 110, 88],
      [5, 65, 41, 5, 66, 42],
      [5, 54, 24, 7, 55, 25],
      [11, 36, 12, 7, 37, 13],

      // 16
      [5, 122, 98, 1, 123, 99],
      [7, 73, 45, 3, 74, 46],
      [15, 43, 19, 2, 44, 20],
      [3, 45, 15, 13, 46, 16],

      // 17
      [1, 135, 107, 5, 136, 108],
      [10, 74, 46, 1, 75, 47],
      [1, 50, 22, 15, 51, 23],
      [2, 42, 14, 17, 43, 15],

      // 18
      [5, 150, 120, 1, 151, 121],
      [9, 69, 43, 4, 70, 44],
      [17, 50, 22, 1, 51, 23],
      [2, 42, 14, 19, 43, 15],

      // 19
      [3, 141, 113, 4, 142, 114],
      [3, 70, 44, 11, 71, 45],
      [17, 47, 21, 4, 48, 22],
      [9, 39, 13, 16, 40, 14],

      // 20
      [3, 135, 107, 5, 136, 108],
      [3, 67, 41, 13, 68, 42],
      [15, 54, 24, 5, 55, 25],
      [15, 43, 15, 10, 44, 16],

      // 21
      [4, 144, 116, 4, 145, 117],
      [17, 68, 42],
      [17, 50, 22, 6, 51, 23],
      [19, 46, 16, 6, 47, 17],

      // 22
      [2, 139, 111, 7, 140, 112],
      [17, 74, 46],
      [7, 54, 24, 16, 55, 25],
      [34, 37, 13],

      // 23
      [4, 151, 121, 5, 152, 122],
      [4, 75, 47, 14, 76, 48],
      [11, 54, 24, 14, 55, 25],
      [16, 45, 15, 14, 46, 16],

      // 24
      [6, 147, 117, 4, 148, 118],
      [6, 73, 45, 14, 74, 46],
      [11, 54, 24, 16, 55, 25],
      [30, 46, 16, 2, 47, 17],

      // 25
      [8, 132, 106, 4, 133, 107],
      [8, 75, 47, 13, 76, 48],
      [7, 54, 24, 22, 55, 25],
      [22, 45, 15, 13, 46, 16],

      // 26
      [10, 142, 114, 2, 143, 115],
      [19, 74, 46, 4, 75, 47],
      [28, 50, 22, 6, 51, 23],
      [33, 46, 16, 4, 47, 17],

      // 27
      [8, 152, 122, 4, 153, 123],
      [22, 73, 45, 3, 74, 46],
      [8, 53, 23, 26, 54, 24],
      [12, 45, 15, 28, 46, 16],

      // 28
      [3, 147, 117, 10, 148, 118],
      [3, 73, 45, 23, 74, 46],
      [4, 54, 24, 31, 55, 25],
      [11, 45, 15, 31, 46, 16],

      // 29
      [7, 146, 116, 7, 147, 117],
      [21, 73, 45, 7, 74, 46],
      [1, 53, 23, 37, 54, 24],
      [19, 45, 15, 26, 46, 16],

      // 30
      [5, 145, 115, 10, 146, 116],
      [19, 75, 47, 10, 76, 48],
      [15, 54, 24, 25, 55, 25],
      [23, 45, 15, 25, 46, 16],

      // 31
      [13, 145, 115, 3, 146, 116],
      [2, 74, 46, 29, 75, 47],
      [42, 54, 24, 1, 55, 25],
      [23, 45, 15, 28, 46, 16],

      // 32
      [17, 145, 115],
      [10, 74, 46, 23, 75, 47],
      [10, 54, 24, 35, 55, 25],
      [19, 45, 15, 35, 46, 16],

      // 33
      [17, 145, 115, 1, 146, 116],
      [14, 74, 46, 21, 75, 47],
      [29, 54, 24, 19, 55, 25],
      [11, 45, 15, 46, 46, 16],

      // 34
      [13, 145, 115, 6, 146, 116],
      [14, 74, 46, 23, 75, 47],
      [44, 54, 24, 7, 55, 25],
      [59, 46, 16, 1, 47, 17],

      // 35
      [12, 151, 121, 7, 152, 122],
      [12, 75, 47, 26, 76, 48],
      [39, 54, 24, 14, 55, 25],
      [22, 45, 15, 41, 46, 16],

      // 36
      [6, 151, 121, 14, 152, 122],
      [6, 75, 47, 34, 76, 48],
      [46, 54, 24, 10, 55, 25],
      [2, 45, 15, 64, 46, 16],

      // 37
      [17, 152, 122, 4, 153, 123],
      [29, 74, 46, 14, 75, 47],
      [49, 54, 24, 10, 55, 25],
      [24, 45, 15, 46, 46, 16],

      // 38
      [4, 152, 122, 18, 153, 123],
      [13, 74, 46, 32, 75, 47],
      [48, 54, 24, 14, 55, 25],
      [42, 45, 15, 32, 46, 16],

      // 39
      [20, 147, 117, 4, 148, 118],
      [40, 75, 47, 7, 76, 48],
      [43, 54, 24, 22, 55, 25],
      [10, 45, 15, 67, 46, 16],

      // 40
      [19, 148, 118, 6, 149, 119],
      [18, 75, 47, 31, 76, 48],
      [34, 54, 24, 34, 55, 25],
      [20, 45, 15, 61, 46, 16]
    ];

    var qrRSBlock = function(totalCount, dataCount) {
      var _this = {};
      _this.totalCount = totalCount;
      _this.dataCount = dataCount;
      return _this;
    };

    var _this = {};

    var getRsBlockTable = function(typeNumber, errorCorrectionLevel) {

      switch(errorCorrectionLevel) {
      case QRErrorCorrectionLevel.L :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
      case QRErrorCorrectionLevel.M :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
      case QRErrorCorrectionLevel.Q :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
      case QRErrorCorrectionLevel.H :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
      default :
        return undefined;
      }
    };

    _this.getRSBlocks = function(typeNumber, errorCorrectionLevel) {

      var rsBlock = getRsBlockTable(typeNumber, errorCorrectionLevel);

      if (typeof rsBlock == 'undefined') {
        throw 'bad rs block @ typeNumber:' + typeNumber +
            '/errorCorrectionLevel:' + errorCorrectionLevel;
      }

      var length = rsBlock.length / 3;

      var list = [];

      for (var i = 0; i < length; i += 1) {

        var count = rsBlock[i * 3 + 0];
        var totalCount = rsBlock[i * 3 + 1];
        var dataCount = rsBlock[i * 3 + 2];

        for (var j = 0; j < count; j += 1) {
          list.push(qrRSBlock(totalCount, dataCount) );
        }
      }

      return list;
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // qrBitBuffer
  //---------------------------------------------------------------------

  var qrBitBuffer = function() {

    var _buffer = [];
    var _length = 0;

    var _this = {};

    _this.getBuffer = function() {
      return _buffer;
    };

    _this.getAt = function(index) {
      var bufIndex = Math.floor(index / 8);
      return ( (_buffer[bufIndex] >>> (7 - index % 8) ) & 1) == 1;
    };

    _this.put = function(num, length) {
      for (var i = 0; i < length; i += 1) {
        _this.putBit( ( (num >>> (length - i - 1) ) & 1) == 1);
      }
    };

    _this.getLengthInBits = function() {
      return _length;
    };

    _this.putBit = function(bit) {

      var bufIndex = Math.floor(_length / 8);
      if (_buffer.length <= bufIndex) {
        _buffer.push(0);
      }

      if (bit) {
        _buffer[bufIndex] |= (0x80 >>> (_length % 8) );
      }

      _length += 1;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrNumber
  //---------------------------------------------------------------------

  var qrNumber = function(data) {

    var _mode = QRMode.MODE_NUMBER;
    var _data = data;

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _data.length;
    };

    _this.write = function(buffer) {

      var data = _data;

      var i = 0;

      while (i + 2 < data.length) {
        buffer.put(strToNum(data.substring(i, i + 3) ), 10);
        i += 3;
      }

      if (i < data.length) {
        if (data.length - i == 1) {
          buffer.put(strToNum(data.substring(i, i + 1) ), 4);
        } else if (data.length - i == 2) {
          buffer.put(strToNum(data.substring(i, i + 2) ), 7);
        }
      }
    };

    var strToNum = function(s) {
      var num = 0;
      for (var i = 0; i < s.length; i += 1) {
        num = num * 10 + chatToNum(s.charAt(i) );
      }
      return num;
    };

    var chatToNum = function(c) {
      if ('0' <= c && c <= '9') {
        return c.charCodeAt(0) - '0'.charCodeAt(0);
      }
      throw 'illegal char :' + c;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrAlphaNum
  //---------------------------------------------------------------------

  var qrAlphaNum = function(data) {

    var _mode = QRMode.MODE_ALPHA_NUM;
    var _data = data;

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _data.length;
    };

    _this.write = function(buffer) {

      var s = _data;

      var i = 0;

      while (i + 1 < s.length) {
        buffer.put(
          getCode(s.charAt(i) ) * 45 +
          getCode(s.charAt(i + 1) ), 11);
        i += 2;
      }

      if (i < s.length) {
        buffer.put(getCode(s.charAt(i) ), 6);
      }
    };

    var getCode = function(c) {

      if ('0' <= c && c <= '9') {
        return c.charCodeAt(0) - '0'.charCodeAt(0);
      } else if ('A' <= c && c <= 'Z') {
        return c.charCodeAt(0) - 'A'.charCodeAt(0) + 10;
      } else {
        switch (c) {
        case ' ' : return 36;
        case '$' : return 37;
        case '%' : return 38;
        case '*' : return 39;
        case '+' : return 40;
        case '-' : return 41;
        case '.' : return 42;
        case '/' : return 43;
        case ':' : return 44;
        default :
          throw 'illegal char :' + c;
        }
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qr8BitByte
  //---------------------------------------------------------------------

  var qr8BitByte = function(data) {

    var _mode = QRMode.MODE_8BIT_BYTE;
    var _data = data;
    var _bytes = qrcode.stringToBytes(data);

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _bytes.length;
    };

    _this.write = function(buffer) {
      for (var i = 0; i < _bytes.length; i += 1) {
        buffer.put(_bytes[i], 8);
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrKanji
  //---------------------------------------------------------------------

  var qrKanji = function(data) {

    var _mode = QRMode.MODE_KANJI;
    var _data = data;

    var stringToBytes = qrcode.stringToBytesFuncs['SJIS'];
    if (!stringToBytes) {
      throw 'sjis not supported.';
    }
    !function(c, code) {
      // self test for sjis support.
      var test = stringToBytes(c);
      if (test.length != 2 || ( (test[0] << 8) | test[1]) != code) {
        throw 'sjis not supported.';
      }
    }('\u53cb', 0x9746);

    var _bytes = stringToBytes(data);

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return ~~(_bytes.length / 2);
    };

    _this.write = function(buffer) {

      var data = _bytes;

      var i = 0;

      while (i + 1 < data.length) {

        var c = ( (0xff & data[i]) << 8) | (0xff & data[i + 1]);

        if (0x8140 <= c && c <= 0x9FFC) {
          c -= 0x8140;
        } else if (0xE040 <= c && c <= 0xEBBF) {
          c -= 0xC140;
        } else {
          throw 'illegal char at ' + (i + 1) + '/' + c;
        }

        c = ( (c >>> 8) & 0xff) * 0xC0 + (c & 0xff);

        buffer.put(c, 13);

        i += 2;
      }

      if (i < data.length) {
        throw 'illegal char at ' + (i + 1);
      }
    };

    return _this;
  };

  //=====================================================================
  // GIF Support etc.
  //

  //---------------------------------------------------------------------
  // byteArrayOutputStream
  //---------------------------------------------------------------------

  var byteArrayOutputStream = function() {

    var _bytes = [];

    var _this = {};

    _this.writeByte = function(b) {
      _bytes.push(b & 0xff);
    };

    _this.writeShort = function(i) {
      _this.writeByte(i);
      _this.writeByte(i >>> 8);
    };

    _this.writeBytes = function(b, off, len) {
      off = off || 0;
      len = len || b.length;
      for (var i = 0; i < len; i += 1) {
        _this.writeByte(b[i + off]);
      }
    };

    _this.writeString = function(s) {
      for (var i = 0; i < s.length; i += 1) {
        _this.writeByte(s.charCodeAt(i) );
      }
    };

    _this.toByteArray = function() {
      return _bytes;
    };

    _this.toString = function() {
      var s = '';
      s += '[';
      for (var i = 0; i < _bytes.length; i += 1) {
        if (i > 0) {
          s += ',';
        }
        s += _bytes[i];
      }
      s += ']';
      return s;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // base64EncodeOutputStream
  //---------------------------------------------------------------------

  var base64EncodeOutputStream = function() {

    var _buffer = 0;
    var _buflen = 0;
    var _length = 0;
    var _base64 = '';

    var _this = {};

    var writeEncoded = function(b) {
      _base64 += String.fromCharCode(encode(b & 0x3f) );
    };

    var encode = function(n) {
      if (n < 0) {
        // error.
      } else if (n < 26) {
        return 0x41 + n;
      } else if (n < 52) {
        return 0x61 + (n - 26);
      } else if (n < 62) {
        return 0x30 + (n - 52);
      } else if (n == 62) {
        return 0x2b;
      } else if (n == 63) {
        return 0x2f;
      }
      throw 'n:' + n;
    };

    _this.writeByte = function(n) {

      _buffer = (_buffer << 8) | (n & 0xff);
      _buflen += 8;
      _length += 1;

      while (_buflen >= 6) {
        writeEncoded(_buffer >>> (_buflen - 6) );
        _buflen -= 6;
      }
    };

    _this.flush = function() {

      if (_buflen > 0) {
        writeEncoded(_buffer << (6 - _buflen) );
        _buffer = 0;
        _buflen = 0;
      }

      if (_length % 3 != 0) {
        // padding
        var padlen = 3 - _length % 3;
        for (var i = 0; i < padlen; i += 1) {
          _base64 += '=';
        }
      }
    };

    _this.toString = function() {
      return _base64;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // base64DecodeInputStream
  //---------------------------------------------------------------------

  var base64DecodeInputStream = function(str) {

    var _str = str;
    var _pos = 0;
    var _buffer = 0;
    var _buflen = 0;

    var _this = {};

    _this.read = function() {

      while (_buflen < 8) {

        if (_pos >= _str.length) {
          if (_buflen == 0) {
            return -1;
          }
          throw 'unexpected end of file./' + _buflen;
        }

        var c = _str.charAt(_pos);
        _pos += 1;

        if (c == '=') {
          _buflen = 0;
          return -1;
        } else if (c.match(/^\s$/) ) {
          // ignore if whitespace.
          continue;
        }

        _buffer = (_buffer << 6) | decode(c.charCodeAt(0) );
        _buflen += 6;
      }

      var n = (_buffer >>> (_buflen - 8) ) & 0xff;
      _buflen -= 8;
      return n;
    };

    var decode = function(c) {
      if (0x41 <= c && c <= 0x5a) {
        return c - 0x41;
      } else if (0x61 <= c && c <= 0x7a) {
        return c - 0x61 + 26;
      } else if (0x30 <= c && c <= 0x39) {
        return c - 0x30 + 52;
      } else if (c == 0x2b) {
        return 62;
      } else if (c == 0x2f) {
        return 63;
      } else {
        throw 'c:' + c;
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // gifImage (B/W)
  //---------------------------------------------------------------------

  var gifImage = function(width, height) {

    var _width = width;
    var _height = height;
    var _data = new Array(width * height);

    var _this = {};

    _this.setPixel = function(x, y, pixel) {
      _data[y * _width + x] = pixel;
    };

    _this.write = function(out) {

      //---------------------------------
      // GIF Signature

      out.writeString('GIF87a');

      //---------------------------------
      // Screen Descriptor

      out.writeShort(_width);
      out.writeShort(_height);

      out.writeByte(0x80); // 2bit
      out.writeByte(0);
      out.writeByte(0);

      //---------------------------------
      // Global Color Map

      // black
      out.writeByte(0x00);
      out.writeByte(0x00);
      out.writeByte(0x00);

      // white
      out.writeByte(0xff);
      out.writeByte(0xff);
      out.writeByte(0xff);

      //---------------------------------
      // Image Descriptor

      out.writeString(',');
      out.writeShort(0);
      out.writeShort(0);
      out.writeShort(_width);
      out.writeShort(_height);
      out.writeByte(0);

      //---------------------------------
      // Local Color Map

      //---------------------------------
      // Raster Data

      var lzwMinCodeSize = 2;
      var raster = getLZWRaster(lzwMinCodeSize);

      out.writeByte(lzwMinCodeSize);

      var offset = 0;

      while (raster.length - offset > 255) {
        out.writeByte(255);
        out.writeBytes(raster, offset, 255);
        offset += 255;
      }

      out.writeByte(raster.length - offset);
      out.writeBytes(raster, offset, raster.length - offset);
      out.writeByte(0x00);

      //---------------------------------
      // GIF Terminator
      out.writeString(';');
    };

    var bitOutputStream = function(out) {

      var _out = out;
      var _bitLength = 0;
      var _bitBuffer = 0;

      var _this = {};

      _this.write = function(data, length) {

        if ( (data >>> length) != 0) {
          throw 'length over';
        }

        while (_bitLength + length >= 8) {
          _out.writeByte(0xff & ( (data << _bitLength) | _bitBuffer) );
          length -= (8 - _bitLength);
          data >>>= (8 - _bitLength);
          _bitBuffer = 0;
          _bitLength = 0;
        }

        _bitBuffer = (data << _bitLength) | _bitBuffer;
        _bitLength = _bitLength + length;
      };

      _this.flush = function() {
        if (_bitLength > 0) {
          _out.writeByte(_bitBuffer);
        }
      };

      return _this;
    };

    var getLZWRaster = function(lzwMinCodeSize) {

      var clearCode = 1 << lzwMinCodeSize;
      var endCode = (1 << lzwMinCodeSize) + 1;
      var bitLength = lzwMinCodeSize + 1;

      // Setup LZWTable
      var table = lzwTable();

      for (var i = 0; i < clearCode; i += 1) {
        table.add(String.fromCharCode(i) );
      }
      table.add(String.fromCharCode(clearCode) );
      table.add(String.fromCharCode(endCode) );

      var byteOut = byteArrayOutputStream();
      var bitOut = bitOutputStream(byteOut);

      // clear code
      bitOut.write(clearCode, bitLength);

      var dataIndex = 0;

      var s = String.fromCharCode(_data[dataIndex]);
      dataIndex += 1;

      while (dataIndex < _data.length) {

        var c = String.fromCharCode(_data[dataIndex]);
        dataIndex += 1;

        if (table.contains(s + c) ) {

          s = s + c;

        } else {

          bitOut.write(table.indexOf(s), bitLength);

          if (table.size() < 0xfff) {

            if (table.size() == (1 << bitLength) ) {
              bitLength += 1;
            }

            table.add(s + c);
          }

          s = c;
        }
      }

      bitOut.write(table.indexOf(s), bitLength);

      // end code
      bitOut.write(endCode, bitLength);

      bitOut.flush();

      return byteOut.toByteArray();
    };

    var lzwTable = function() {

      var _map = {};
      var _size = 0;

      var _this = {};

      _this.add = function(key) {
        if (_this.contains(key) ) {
          throw 'dup key:' + key;
        }
        _map[key] = _size;
        _size += 1;
      };

      _this.size = function() {
        return _size;
      };

      _this.indexOf = function(key) {
        return _map[key];
      };

      _this.contains = function(key) {
        return typeof _map[key] != 'undefined';
      };

      return _this;
    };

    return _this;
  };

  var createDataURL = function(width, height, getPixel) {
    var gif = gifImage(width, height);
    for (var y = 0; y < height; y += 1) {
      for (var x = 0; x < width; x += 1) {
        gif.setPixel(x, y, getPixel(x, y) );
      }
    }

    var b = byteArrayOutputStream();
    gif.write(b);

    var base64 = base64EncodeOutputStream();
    var bytes = b.toByteArray();
    for (var i = 0; i < bytes.length; i += 1) {
      base64.writeByte(bytes[i]);
    }
    base64.flush();

    return 'data:image/gif;base64,' + base64;
  };

  //---------------------------------------------------------------------
  // returns qrcode function.

  return qrcode;
}();

// multibyte support
!function() {

  qrcode.stringToBytesFuncs['UTF-8'] = function(s) {
    // http://stackoverflow.com/questions/18729405/how-to-convert-utf8-string-to-byte-array
    function toUTF8Array(str) {
      var utf8 = [];
      for (var i=0; i < str.length; i++) {
        var charcode = str.charCodeAt(i);
        if (charcode < 0x80) utf8.push(charcode);
        else if (charcode < 0x800) {
          utf8.push(0xc0 | (charcode >> 6),
              0x80 | (charcode & 0x3f));
        }
        else if (charcode < 0xd800 || charcode >= 0xe000) {
          utf8.push(0xe0 | (charcode >> 12),
              0x80 | ((charcode>>6) & 0x3f),
              0x80 | (charcode & 0x3f));
        }
        // surrogate pair
        else {
          i++;
          // UTF-16 encodes 0x10000-0x10FFFF by
          // subtracting 0x10000 and splitting the
          // 20 bits of 0x0-0xFFFFF into two halves
          charcode = 0x10000 + (((charcode & 0x3ff)<<10)
            | (str.charCodeAt(i) & 0x3ff));
          utf8.push(0xf0 | (charcode >>18),
              0x80 | ((charcode>>12) & 0x3f),
              0x80 | ((charcode>>6) & 0x3f),
              0x80 | (charcode & 0x3f));
        }
      }
      return utf8;
    }
    return toUTF8Array(s);
  };

}();

(function (factory) {
  if (typeof define === 'function' && define.amd) {
      define([], factory);
  } else if (typeof exports === 'object') {
      module.exports = factory();
  }
}(function () {
    return qrcode;
}));


const VERSION = '1.8.6-ubuntu26.8';
const STATE_TTL = 1800; // ثانیه — انقضای وضعیت انتظار ورودی کاربر
const SHETAB_AMOUNT_TTL = 30 * 86400; // رزرو مبلغ یکتا پس از سفارش/پرداخت
const KV_BACKUP_CRON = '0 */3 * * *';           // هر ۳ ساعت (هماهنگ با systemd/tiznetvpn-backup.timer)
const KV_BACKUP_MIN_INTERVAL_MS = 2.5 * 60 * 60 * 1000; // فاصلهٔ ایمنی کمتر از بازهٔ ۳ ساعت تا ارسال بعدی رد نشود
const KV_BACKUP_LAST_KEY = 'system:kv_backup_last_at';
const KV_BACKUP_LOCK_KEY = 'system:kv_backup_lock';
const KV_RESTORE_LOCK_KEY = 'system:kv_restore_lock';
const MAX_KV_RESTORE_UPLOAD_BYTES = 45 * 1024 * 1024;
const MAX_KV_RESTORE_JSON_BYTES = 128 * 1024 * 1024;

/* ============================ ابزارهای عمومی ============================ */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// تبدیل ارقام فارسی/عربی به انگلیسی
function normDigits(s) {
  const fa = '۰۱۲۳۴۵۶۷۸۹';
  const ar = '٠١٢٣٤٥٦٧٨٩';
  return String(s == null ? '' : s).replace(/[۰-۹٠-٩]/g, (ch) => {
    const i = fa.indexOf(ch);
    if (i >= 0) return String(i);
    return String(ar.indexOf(ch));
  });
}

function parseMoney(s) {
  const n = parseInt(normDigits(s).replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

function parseNum(s) {
  const n = parseFloat(normDigits(s).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// پاک‌سازی ورودی از کاراکترهای نامرئی (کیبورد فارسی موبایل گاهی این‌ها را قاطی کپی می‌کند)
function cleanText(s) {
  let out = '';
  const str = String(s == null ? '' : s);
  for (const ch of str) {
    const c = ch.codePointAt(0);
    const invisible = (c >= 0x200B && c <= 0x200F) || (c >= 0x202A && c <= 0x202E) || (c >= 0x2066 && c <= 0x2069) || c === 0xFEFF;
    if (!invisible) out += ch;
  }
  return out.replace(/\s+/g, ' ').trim();
}

// بیرون کشیدن اولین URL از متن (حتی اگر دورش متن فارسی باشد)
function extractUrl(s) {
  const c = cleanText(s);
  const m = c.match(/https?:\/\/[^\s<>()[\]{}"']+/i);
  if (!m) return '';
  return m[0].replace(/[.,;:!?)\]}>]+$/, '');
}

// اگر کاربر لینک کامل یوزر (با uuid آخرش) را فرستاد، uuid را حذف کن
function stripTrailingUuid(p) {
  return String(p || '').replace(/\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\/?$/, '');
}

function uid(n) {
  n = n || 6;
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  try {
    const b = crypto.getRandomValues(new Uint8Array(n));
    for (let i = 0; i < n; i++) s += A[b[i] % A.length];
  } catch (e) {
    for (let i = 0; i < n; i++) s += A[Math.floor(Math.random() * A.length)];
  }
  return s;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function fmtToman(n) {
  return Number(n || 0).toLocaleString('en-US') + ' تومان';
}

// واحدهای داخلی فروشگاه تومان است؛ این تبدیل فقط برای ورود مبلغ در فرم ریالی بانک است.
function rialFromToman(n) {
  const toman = Number(n);
  const rial = toman * 10;
  return Number.isSafeInteger(toman) && toman >= 0 && Number.isSafeInteger(rial) ? rial : null;
}

function fmtRialFromToman(n) {
  const rial = rialFromToman(n);
  return rial == null ? '—' : rial.toLocaleString('en-US') + ' ریال';
}

function fmtGB(n) {
  if (n == null) return '—';
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  if (v >= 100000) return 'نامحدود';
  return (Math.round(v * 100) / 100) + ' گیگ';
}

function faNum(x) {
  const fa = '۰۱۲۳۴۵۶۷۸۹';
  return String(x).replace(/\d/g, (d) => fa[Number(d)]);
}

// تبدیل میلادی به شمسی (الگوریتم استاندارد)
function g2j(gy, gm, gd) {
  const gdm = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy = gy <= 1600 ? 0 : 979;
  gy -= gy <= 1600 ? 621 : 1600;
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days = 365 * gy + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) +
    Math.floor((gy2 + 399) / 400) - 80 + gd + gdm[gm - 1];
  jy += 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) { jy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return [jy, jm, jd];
}

function jstr(d) {
  if (!(d instanceof Date) || isNaN(d)) return '—';
  const r = g2j(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  return faNum(r[0] + '/' + String(r[1]).padStart(2, '0') + '/' + String(r[2]).padStart(2, '0'));
}

// برداشت تاریخ از خروجی پنل (مثل "2026-10-21" یا "2026-10-21 12:00:00")
function parseDate10(v) {
  if (!v) return null;
  const m = String(v).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return isNaN(d) ? null : d;
}

function diffDaysUTC(a, b) {
  return Math.floor((Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()) -
    Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate())) / 86400000);
}

function addDaysUTC(d, n) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));
}

// محاسبه روزهای باقی‌مانده و تاریخ انقضا مثل منطق پنل (package_days - (today - start_date))
function planRemaining(huser) {
  const pkg = huser && huser.package_days != null ? Number(huser.package_days) : null;
  const sd = huser ? parseDate10(huser.start_date) : null;
  if (pkg == null || !Number.isFinite(pkg)) return { days: null, expiry: null };
  if (!sd) return { days: pkg, expiry: null };
  const now = new Date();
  const days = pkg - diffDaysUTC(sd, now);
  return { days: days, expiry: addDaysUTC(sd, pkg) };
}

function subName(tgid) {
  return ('u' + tgid + '_' + uid(4)).toLowerCase();
}

/* ============================ دیتابیس (KV) ============================ */

async function kvGet(env, key, def) {
  try {
    const v = await env.DB.get(key, { type: 'json' });
    return v == null ? def : v;
  } catch (e) { return def; }
}

async function kvPut(env, key, val, ttl) {
  const opt = ttl ? { expirationTtl: ttl } : undefined;
  await env.DB.put(key, JSON.stringify(val), opt);
}

async function kvDel(env, key) {
  try { await env.DB.delete(key); } catch (e) {}
}

async function kvList(env, prefix) {
  const out = [];
  let cursor = undefined;
  do {
    const r = await env.DB.list({ prefix: prefix, cursor: cursor });
    for (const k of r.keys) out.push(k.name);
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  return out;
}

// ایندکس‌های مرتب‌شدهٔ زمان‌محور برای گزارش، بدون اسکن/خواندن کل KV در هر بازدید Mini App.
const INDEX_TIME_MAX = 9999999999999;
function reverseIndexTime(value) {
  const n = Math.max(0, Math.min(INDEX_TIME_MAX, Math.floor(Number(value) || Date.now())));
  return String(INDEX_TIME_MAX - n).padStart(13, '0');
}
async function putIndexSafely(env, key, value) {
  try { await kvPut(env, key, value); return true; } catch (e) { return false; }
}
async function writeOrderIndex(env, order) {
  if (!order || !order.id) return false;
  const ts = Number(order.created_at || Date.now());
  const id = String(order.id);
  const globalOk = await putIndexSafely(env, 'order_idx:' + reverseIndexTime(ts) + ':' + id, {
    id: id, created_at: ts, tg_id: String(order.tg_id == null ? '' : order.tg_id)
  });
  let userOk = true;
  if (order.tg_id != null) {
    userOk = await putIndexSafely(env, 'user_order_idx:' + String(order.tg_id) + ':' + reverseIndexTime(ts) + ':' + id, {
      id: id, created_at: ts
    });
  }
  return globalOk && userOk;
}
async function writeLedgerIndex(env, row) {
  if (!row || !row.id || !row.kind) return false;
  const ts = Number(row.occurred_at || row.created_at || Date.now());
  const globalOk = await putIndexSafely(env, 'ledger_idx:' + String(row.kind) + ':' + reverseIndexTime(ts) + ':' + String(row.id), row);
  let userLedgerOk = true;
  let userSaleOk = true;
  if (row.tg_id != null) {
    userLedgerOk = await putIndexSafely(env, 'user_ledger_idx:' + String(row.tg_id) + ':' + reverseIndexTime(ts) + ':' + String(row.kind) + ':' + String(row.id), {
      id: String(row.id), kind: String(row.kind), occurred_at: ts
    });
  }
  // فروش‌های کیف‌پولی order_id ندارند؛ برای نمایش سابقهٔ خرید، آن‌ها را هم در ایندکس سفارش مشتری نگه می‌داریم.
  if (row.kind === 'sale' && row.tg_id != null && !row.order_id) {
    userSaleOk = await putIndexSafely(env, 'user_order_idx:' + String(row.tg_id) + ':' + reverseIndexTime(ts) + ':ledger-' + String(row.id), {
      id: String(row.id), created_at: ts, source: 'ledger'
    });
  }
  return globalOk && userLedgerOk && userSaleOk;
}
async function writeWithdrawIndex(env, withdrawal) {
  if (!withdrawal || !withdrawal.id || withdrawal.tg_id == null) return false;
  const ts = Number(withdrawal.created_at || Date.now());
  return putIndexSafely(env, 'user_withdraw_idx:' + String(withdrawal.tg_id) + ':' + reverseIndexTime(ts) + ':' + String(withdrawal.id), {
    id: String(withdrawal.id), created_at: ts
  });
}

const CUSTOMER_ACTIVITY_TTL = 180 * 86400;
function customerActivityFromUpdate(update) {
  const callback = update && update.callback_query;
  if (callback) {
    const data = String(callback.data || '');
    if (data === 'home') return 'open_home';
    if (data === 'buy' || data.startsWith('bp:') || data.startsWith('bl:')) return 'browse_plans';
    if (data === 'wallet' || data.startsWith('chg:')) return 'open_wallet';
    if (data === 'mysubs' || data.startsWith('rnw:') || data.startsWith('rp:')) return 'open_subscriptions';
    if (data === 'ref') return 'open_referrals';
    if (data === 'help') return 'open_help';
    if (data === 'apps') return 'open_apps';
    if (data === 'sup') return 'open_support';
    if (data.startsWith('a_ok:')) return 'admin_approve_order';
    if (data.startsWith('a_no:') || data.startsWith('a_nogo:')) return 'admin_reject_order';
    if (data.startsWith('u_')) return 'admin_manage_customer';
    if (data.startsWith('w_')) return 'admin_manage_withdrawal';
    if (data.startsWith('a_') || data.startsWith('s_')) return 'admin_manage_store';
    return 'button_interaction';
  }
  const message = update && update.message;
  if (!message) return 'telegram_interaction';
  if (message.web_app_data) return 'miniapp_interaction';
  const text = String(message.text || '').trim();
  if (text.startsWith('/')) {
    const command = (text.split(/\s+/)[0] || '/command').toLowerCase();
    return 'command_' + command.replace(/[^a-z0-9_]/g, '').slice(0, 24);
  }
  if (Array.isArray(message.photo) && message.photo.length) return 'photo_message';
  if (message.document) return 'document_message';
  if (message.contact) return 'contact_shared';
  if (message.location) return 'location_shared';
  if (text) return 'text_message';
  return 'other_message';
}
async function recordCustomerActivity(env, tgid, action, details, eventId) {
  const id = String(tgid == null ? '' : tgid).replace(/[^0-9]/g, '').slice(0, 20);
  if (!/^\d{1,20}$/.test(id) || !action) return false;
  const at = Date.now();
  const suffix = /^[A-Za-z0-9_-]{1,40}$/.test(String(eventId || '')) ? String(eventId) : uid(8);
  const event = { tg_id: id, at: at, action: String(action).slice(0, 48) };
  const meta = details && typeof details === 'object' ? details : {};
  if (meta.order_id != null) event.order_id = String(meta.order_id).slice(0, 40);
  if (Number.isFinite(Number(meta.amount)) && meta.amount != null) event.amount = Number(meta.amount);
  if (meta.kind != null) event.kind = String(meta.kind).slice(0, 24);
  if (meta.actor_id != null) event.actor_id = String(meta.actor_id).replace(/[^0-9]/g, '').slice(0, 20);
  try {
    await kvPut(env, 'user_activity_idx:' + id + ':' + reverseIndexTime(at) + ':' + suffix, event, CUSTOMER_ACTIVITY_TTL);
    return true;
  } catch (e) { return false; }
}
async function writeUserIndex(env, user) {
  if (!user || user.tg_id == null) return false;
  const ts = Number(user.joined_at || Date.now());
  return putIndexSafely(env, 'user_idx:' + reverseIndexTime(ts) + ':' + String(user.tg_id), {
    tg_id: String(user.tg_id), joined_at: ts
  });
}
async function listIndexedValues(env, prefix, requestedLimit) {
  const limit = Math.max(1, Math.min(500, Number(requestedLimit) || 100));
  const result = await env.DB.list({ prefix: prefix, limit: limit });
  const values = await Promise.all((result.keys || []).map((k) => kvGet(env, k.name, null)));
  return {
    items: values.filter(Boolean),
    has_more: !result.list_complete,
    cursor: result.cursor || null,
    key_count: (result.keys || []).length
  };
}
async function countPrefixBounded(env, prefix, maxPages) {
  let count = 0;
  let cursor = undefined;
  const pages = Math.max(1, Math.min(10, Number(maxPages) || 5));
  for (let i = 0; i < pages; i++) {
    const result = await env.DB.list({ prefix: prefix, limit: 1000, cursor: cursor });
    count += (result.keys || []).length;
    if (result.list_complete) return { count: count, partial: false };
    cursor = result.cursor;
    if (!cursor) return { count: count, partial: true };
  }
  return { count: count, partial: !!cursor };
}

const DEFAULT_SETTINGS = {
  bot_username: '',
  support: '',
  card_number: '',
  card_holder: '',
  card_manual_enabled: true,  // کارت‌به‌کارت دستی (رسید + تأیید ادمین)
  card_auto_enabled: false,   // کارت‌به‌کارت خودکار Shetab؛ نیازمند فعال‌سازی صریح ادمین
  commission: 10,       // درصد پورسانت نمایندگی
  min_withdraw: 50000,   // حداقل مبلغ برداشت (تومان)
  total_revenue: 0,
  total_sales: 0,
  welcome: '👋 خوش آمدید!\nاز منوی زیر سرویس مناسب خود را انتخاب کنید:',
  free_subscription_enabled: false,
  free_subscription_gb: 1,
  free_subscription_days: 1,
  free_subscription_panel_id: '',
  free_subscription_claim_policy: ''
};

async function getCfg(env) {
  const c = await kvGet(env, 'cfg', {});
  return Object.assign({}, DEFAULT_SETTINGS, c || {});
}
async function saveCfg(env, c) { await kvPut(env, 'cfg', c); }

async function getPanels(env) { return await kvGet(env, 'panels', {}); }
async function savePanels(env, p) { await kvPut(env, 'panels', p); }
async function getPlans(env) { return await kvGet(env, 'plans', {}); }
async function savePlans(env, p) { await kvPut(env, 'plans', p); }

async function getUser(env, tgid) { return await kvGet(env, 'u:' + tgid, null); }
async function saveUser(env, u) {
  if (!u || u.tg_id == null) return;
  const stored = Object.assign({}, u);
  delete stored._isNew;
  await kvPut(env, 'u:' + u.tg_id, stored);
}

const AGENT_RECORD_MUTEX = new Map();
const AGENT_INVITE_MUTEX = new Map();
async function getAgent(env, tgid) {
  const id = String(tgid == null ? '' : tgid);
  return /^\d{1,20}$/.test(id) ? await kvGet(env, 'agent:' + id, null) : null;
}
async function saveAgent(env, agent) {
  if (!agent || !/^\d{1,20}$/.test(String(agent.tg_id || ''))) throw new Error('invalid_agent_record');
  agent.updated_at = Date.now();
  await kvPut(env, 'agent:' + String(agent.tg_id), agent);
}
function miniAppAgentId(value) {
  const id = String(value == null ? '' : value).trim();
  return /^\d{1,20}$/.test(id) ? id : '';
}
function miniAppAgentDefaultPrices(plans) {
  const prices = {};
  for (const [key, plan] of Object.entries(plans || {})) {
    if (!plan || !isRecordEnabled(plan)) continue;
    const id = String(plan.id || key);
    const price = Number(plan.price);
    if (id && Number.isSafeInteger(price) && price > 0) prices[id] = price;
  }
  return prices;
}
function miniAppAgentView(agent, user) {
  const record = agent || {};
  const profile = user || {};
  return {
    id: String(record.tg_id || record.id || ''),
    tg_id: String(record.tg_id || record.id || ''),
    first_name: String(profile.first_name || record.first_name || ''),
    username: String(profile.username || record.username || ''),
    enabled: isRecordEnabled(record),
    balance: Math.max(0, Number(record.balance || 0)),
    quota_remaining: Math.max(0, Math.floor(Number(record.quota_remaining || 0))),
    total_created: Math.max(0, Math.floor(Number(record.total_created || 0))),
    created_at: Number(record.created_at || 0),
    updated_at: Number(record.updated_at || 0)
  };
}
async function createAgentRecord(env, tgid, user, actorId) {
  const id = miniAppAgentId(tgid);
  if (!id || isAdmin(env, id) || AGENT_RECORD_MUTEX.has(id)) return null;
  const mutexToken = {};
  AGENT_RECORD_MUTEX.set(id, mutexToken);
  try {
    if (await getAgent(env, id)) return null;
    const profile = user || await getUser(env, id) || {};
    const plans = await getPlans(env);
    const now = Date.now();
    const agent = {
      id: id, tg_id: id, first_name: String(profile.first_name || '').slice(0, 128),
      username: String(profile.username || '').slice(0, 64), enabled: true,
      balance: 0, quota_remaining: 0, total_created: 0,
      plan_prices: miniAppAgentDefaultPrices(plans),
      created_by: String(actorId || ''), created_at: now, updated_at: now
    };
    await kvPut(env, 'agent:' + id, agent);
    return agent;
  } finally {
    if (AGENT_RECORD_MUTEX.get(id) === mutexToken) AGENT_RECORD_MUTEX.delete(id);
  }
}
async function acceptAgentInvite(env, user, token) {
  const code = String(token || '').trim();
  const id = miniAppAgentId(user && user.tg_id);
  if (!id || !/^[A-Z2-9]{10,32}$/.test(code)) return { ok: false, error: 'invalid_agent_invite' };
  if (isAdmin(env, id)) return { ok: false, error: 'admin_cannot_be_agent' };
  if (AGENT_INVITE_MUTEX.has(code)) return { ok: false, error: 'agent_invite_processing' };
  const mutexToken = {};
  AGENT_INVITE_MUTEX.set(code, mutexToken);
  const lockKey = 'agent_invite_lock:' + code;
  let lockOwned = false;
  try {
    const held = await kvGet(env, lockKey, null);
    if (held && Date.now() - Number(held.started_at || 0) < 30000) return { ok: false, error: 'agent_invite_processing' };
    await kvPut(env, lockKey, { started_at: Date.now(), user_id: id }, 45);
    lockOwned = true;
    const inviteKey = 'agent_invite:' + code;
    const invite = await kvGet(env, inviteKey, null);
    if (!invite || Number(invite.expires_at || 0) <= Date.now()) return { ok: false, error: 'invalid_agent_invite' };
    const alreadyCreated = await getAgent(env, id);
    if (invite.used_by && String(invite.used_by) === id && alreadyCreated) {
      return { ok: true, agent: miniAppAgentView(alreadyCreated, user), duplicate: true };
    }
    const ownStaleClaim = invite.used_by && String(invite.used_by) === id && invite.acceptance_state === 'processing';
    if (invite.active !== true && !ownStaleClaim) return { ok: false, error: 'invalid_agent_invite' };
    if (invite.used_by && String(invite.used_by) !== id) return { ok: false, error: 'invalid_agent_invite' };
    if (alreadyCreated) return { ok: false, error: 'agent_account_exists' };
    if (!ownStaleClaim) {
      invite.active = false;
      invite.used_by = id;
      invite.used_at = Date.now();
      invite.acceptance_state = 'processing';
      await kvPut(env, inviteKey, invite, Math.max(60, Math.ceil((Number(invite.expires_at) - Date.now()) / 1000)));
    }
    let agent;
    try { agent = await createAgentRecord(env, id, user, invite.created_by || 'invite'); }
    catch (e) {
      if (!(await getAgent(env, id))) {
        invite.active = true; invite.used_by = ''; invite.used_at = 0; delete invite.acceptance_state;
        await kvPut(env, inviteKey, invite, Math.max(60, Math.ceil((Number(invite.expires_at) - Date.now()) / 1000)));
      }
      throw e;
    }
    if (!agent) {
      const existing = await getAgent(env, id);
      if (existing) return { ok: true, agent: miniAppAgentView(existing, user), duplicate: true };
      invite.active = true; invite.used_by = ''; invite.used_at = 0; delete invite.acceptance_state;
      await kvPut(env, inviteKey, invite, Math.max(60, Math.ceil((Number(invite.expires_at) - Date.now()) / 1000)));
      return { ok: false, error: 'agent_account_exists' };
    }
    invite.active = false;
    invite.used_by = id;
    invite.used_at = Date.now();
    invite.acceptance_state = 'done';
    await kvPut(env, inviteKey, invite, Math.max(60, Math.ceil((Number(invite.expires_at) - Date.now()) / 1000)));
    return { ok: true, agent: miniAppAgentView(agent, user) };
  } finally {
    if (lockOwned) await kvDel(env, lockKey);
    if (AGENT_INVITE_MUTEX.get(code) === mutexToken) AGENT_INVITE_MUTEX.delete(code);
  }
}

async function ensureUser(env, tg) {
  let u = await getUser(env, tg.id);
  if (!u) {
    u = {
      tg_id: tg.id, username: tg.username || '', first_name: tg.first_name || '',
      balance: 0, earned: 0, invited: 0, referred_by: null, first_paid: false,
      ref_code: uid(8), subs: [], banned: false, total_spent: 0, joined_at: Date.now(), last_activity_at: Date.now(), miniapp_indexed: true
    };
    await kvPut(env, 'ref:' + u.ref_code, tg.id);
    await saveUser(env, u);
    await writeUserIndex(env, u);
    u._isNew = true;
  } else {
    let ch = false;
    if (Object.prototype.hasOwnProperty.call(u, '_isNew')) { delete u._isNew; ch = true; }
    if (Date.now() - Number(u.last_activity_at || u.joined_at || 0) >= 60000) { u.last_activity_at = Date.now(); ch = true; }
    if ((tg.username || '') !== (u.username || '')) { u.username = tg.username || ''; ch = true; }
    if ((tg.first_name || '') !== (u.first_name || '')) { u.first_name = tg.first_name || ''; ch = true; }
    if (!u.miniapp_indexed) { u.miniapp_indexed = true; ch = true; await writeUserIndex(env, u); }
    if (ch) await saveUser(env, u);
  }
  return u;
}

async function getSub(env, sid) { return await kvGet(env, 's:' + sid, null); }
async function saveSub(env, s) { await kvPut(env, 's:' + s.sid, s); }
async function delSub(env, sid) { await kvDel(env, 's:' + sid); }

async function getOrder(env, oid) { return await kvGet(env, 'o:' + oid, null); }
async function newOrder(env, o) {
  o.id = o.id || uid(6);
  o.status = 'pending';
  o.created_at = Date.now();
  await kvPut(env, 'o:' + o.id, o);
  await writeOrderIndex(env, o);
  await recordCustomerActivity(env, o.tg_id, 'order_created', { order_id: o.id, kind: o.type, amount: o.amount });
  const p = await kvGet(env, 'pend', []);
  p.push(o.id);
  await kvPut(env, 'pend', p);
  // یک نقطهٔ مرکزی برای همهٔ مسیرهای ساخت سفارش (ربات، Mini App، کیف پول و Shetab).
  // خطای اطلاع‌رسانی نباید ثبت سفارش را ناموفق جلوه دهد یا سفارش تکراری بسازد.
  try { await adminNotifyOrder(env, o); } catch (e) {}
  return o;
}
async function saveOrder(env, o) {
  o.updated_at = Date.now();
  await kvPut(env, 'o:' + o.id, o);
  if (o.status !== 'pending') {
    const p = await kvGet(env, 'pend', []);
    await kvPut(env, 'pend', p.filter((x) => x !== o.id));
  }
}

// دفتر رویدادهای مالیِ آینده؛ فروش کیف‌پولی هم مثل سفارش‌های دستی/خودکار ثبت می‌شود.
async function recordLedger(env, entry) {
  const id = String(entry.id || uid(10));
  const kind = String(entry.kind || 'sale');
  const key = 'ledger:' + kind + ':' + id;
  const existing = await kvGet(env, key, null);
  if (existing) return existing; // ثبت idempotent برای جلوگیری از دوباره‌شماری
  const row = Object.assign({}, entry, {
    id: id,
    kind: kind,
    amount: Number(entry.amount || 0),
    currency: 'TOMAN',
    created_at: Number(entry.created_at || Date.now())
  });
  await kvPut(env, key, row);
  await writeLedgerIndex(env, row);
  return row;
}

async function recordLedgerSafely(env, entry) {
  try { return await recordLedger(env, entry); }
  catch (e) {
    try { await notifyAdmins(env, '⚠️ <b>ثبت رویداد در گزارش مالی ناموفق بود.</b>\nشناسه: <code>' + esc(entry.id || '—') + '</code>\nخطا: <code>' + esc(String((e && e.message) || e).slice(0, 250)) + '</code>'); } catch (e2) {}
    return null;
  }
}

async function getWithdraw(env, wid) { return await kvGet(env, 'w:' + wid, null); }
async function newWithdraw(env, w) {
  w.id = uid(6);
  w.status = 'pending';
  w.created_at = Date.now();
  await kvPut(env, 'w:' + w.id, w);
  await writeWithdrawIndex(env, w);
  await recordCustomerActivity(env, w.tg_id, 'withdrawal_requested', { amount: w.amount });
  const p = await kvGet(env, 'wpend', []);
  p.push(w.id);
  await kvPut(env, 'wpend', p);
  return w;
}
async function saveWithdraw(env, w) {
  await kvPut(env, 'w:' + w.id, w);
  if (w.status !== 'pending') {
    const p = await kvGet(env, 'wpend', []);
    await kvPut(env, 'wpend', p.filter((x) => x !== w.id));
  }
}

async function setState(env, tgid, step, data) {
  await kvPut(env, 'st:' + tgid, { step: step, data: data || {} }, STATE_TTL);
}
async function getState(env, tgid) { return await kvGet(env, 'st:' + tgid, null); }
async function clearState(env, tgid) { await kvDel(env, 'st:' + tgid); }

/* ============================ ادمین‌ها ============================ */

function adminIds(env) {
  return String(env.ADMIN_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
}
function isAdmin(env, tgid) {
  return adminIds(env).indexOf(String(tgid)) >= 0;
}

// رابط تلگرام کلاسیک برای مشتری و مدیر قابل خاموش‌کردن است، بدون حذف کدهای legacy.
// پیش‌فرض امن برای نسخهٔ جدید: همهٔ خرید/مدیریت از Mini App انجام شود.
function miniAppOnlyMode(env) {
  const value = String((env && env.MINIAPP_ONLY_MODE) == null ? 'true' : env.MINIAPP_ONLY_MODE).trim().toLowerCase();
  return !['0', 'false', 'off', 'no', 'disabled'].includes(value);
}
function telegramExtra(env, extra) {
  const safe = Object.assign({}, extra || {});
  if (miniAppOnlyMode(env) && !isAllowedMiniAppOnlyMarkup(safe.reply_markup)) delete safe.reply_markup;
  return safe;
}

/* ============================ تلگرام ============================ */

async function tg(env, method, params) {
  const r = await fetch('https://api.telegram.org/bot' + env.BOT_TOKEN + '/' + method, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params || {})
  });
  let j = {};
  try { j = await r.json(); } catch (e) {}
  if (!j.ok) throw new Error('TG ' + method + ': ' + (j.description || ('HTTP ' + r.status)));
  return j.result;
}

function KB(rows) { return { reply_markup: { inline_keyboard: rows } }; }
function BTN(text, cb) { return { text: text, callback_data: cb }; }
function WEBAPPBTN(text, url) { return { text: text, web_app: { url: url } }; }
const BOT_CUSTOMER_BUTTONS = ['خرید اشتراک', 'پشتیبانی', 'اشتراک رایگان', 'راهنما', 'اطلاعات حساب', 'دریافت نمایندگی'];
function isAllowedMiniAppOnlyMarkup(markup) {
  if (!markup || typeof markup !== 'object') return false;
  if (Array.isArray(markup.inline_keyboard)) {
    const rows = markup.inline_keyboard;
    if (rows.length !== 1 || !Array.isArray(rows[0]) || rows[0].length !== 1) return false;
    const button = rows[0][0];
    if (!button || button.text !== 'ورود به اپ' || !button.web_app || Object.keys(button).some((key) => !['text', 'web_app'].includes(key))) return false;
    try { return new URL(String(button.web_app.url || '')).protocol === 'https:'; } catch (e) { return false; }
  }
  if (Array.isArray(markup.keyboard)) {
    const buttons = markup.keyboard.flat();
    if (buttons.length !== BOT_CUSTOMER_BUTTONS.length) return false;
    const texts = buttons.map((button) => {
      if (!button || typeof button !== 'object' || Object.keys(button).some((key) => key !== 'text')) return '';
      return String(button.text || '');
    });
    return BOT_CUSTOMER_BUTTONS.every((label) => texts.filter((text) => text === label).length === 1);
  }
  return false;
}
function mainBotReplyMarkup() {
  return { reply_markup: {
    keyboard: [
      [{ text: BOT_CUSTOMER_BUTTONS[0] }, { text: BOT_CUSTOMER_BUTTONS[1] }],
      [{ text: BOT_CUSTOMER_BUTTONS[2] }, { text: BOT_CUSTOMER_BUTTONS[3] }],
      [{ text: BOT_CUSTOMER_BUTTONS[4] }, { text: BOT_CUSTOMER_BUTTONS[5] }]
    ],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: 'یک گزینه را انتخاب کنید'
  } };
}
function miniAppUrl(env, origin) {
  const configured = String(env.MINIAPP_URL || '').trim();
  if (configured) {
    try { const u = new URL(configured); if (u.protocol === 'https:') return u.toString(); } catch (e) {}
  }
  try { const u = new URL('/miniapp', origin); return u.protocol === 'https:' ? u.toString() : ''; } catch (e) { return ''; }
}
const MINIAPP_MENU_BUTTON_VERSION = 'tiznetvpn-menu-button-ubuntu-v1';
async function ensureBotCommandsMode(env) {
  const mode = miniAppOnlyMode(env) ? 'miniapp-approved-buttons-v2' : 'legacy-v1';
  if (await kvGet(env, 'system:bot_commands_mode', '') === mode) return;
  const commands = miniAppOnlyMode(env)
    ? [{ command: 'start', description: 'بازکردن اپ فروش' }]
    : [
        { command: 'start', description: 'شروع و منوی اصلی' },
        { command: 'admin', description: 'پنل مدیریت' },
        { command: 'cancel', description: 'لغو عملیات جاری' }
      ];
  try {
    await tg(env, 'setMyCommands', { commands: commands });
    await kvPut(env, 'system:bot_commands_mode', mode);
  } catch (e) {}
}
async function ensureMiniAppMenuButton(env, user, chatId, origin) {
  if (!user) return;
  await ensureBotCommandsMode(env);
  if (user.miniapp_menu_set_version === MINIAPP_MENU_BUTTON_VERSION) return;
  const webAppUrl = miniAppUrl(env, origin);
  if (!webAppUrl) return;
  try {
    // برچسب کوتاه لاتین در دکمهٔ آبی Mini App تلگرام.
    await tg(env, 'setChatMenuButton', {
      chat_id: chatId,
      menu_button: { type: 'web_app', text: 'tiznet', web_app: { url: webAppUrl } }
    });
    user.miniapp_menu_set = true;
    user.miniapp_menu_set_version = MINIAPP_MENU_BUTTON_VERSION;
    await saveUser(env, user);
  } catch (e) {}
}
function COPYBTN(text, value) { return { text: text, copy_text: { text: String(value) } }; }

async function msg(env, chat_id, text, extra) {
  return tg(env, 'sendMessage', Object.assign({
    chat_id: chat_id, text: text, parse_mode: 'HTML', disable_web_page_preview: true
  }, telegramExtra(env, extra)));
}

async function editMsg(env, chat_id, message_id, text, extra) {
  try {
    const safeExtra = telegramExtra(env, extra);
    if (miniAppOnlyMode(env)) safeExtra.reply_markup = { inline_keyboard: [] };
    await tg(env, 'editMessageText', Object.assign({
      chat_id: chat_id, message_id: message_id, text: text,
      parse_mode: 'HTML', disable_web_page_preview: true
    }, safeExtra));
  } catch (e) {
    const m = String((e && e.message) || '');
    if (m.indexOf('message is not modified') >= 0) return;
    if (m.indexOf('message to edit not found') >= 0 || m.indexOf("message can't be edited") >= 0) {
      await msg(env, chat_id, text, extra);
      return;
    }
    throw e;
  }
}

// پیام سفارش دستی ممکن است متن یا عکسِ رسید باشد؛ برای هر دو نوع، وضعیت اصلی را همان‌جا عوض می‌کنیم.
async function updateAdminOrderMessage(env, source, text, extra) {
  if (!source || !source.chat || !source.message_id) return false;
  const safeExtra = telegramExtra(env, extra);
  if (miniAppOnlyMode(env)) safeExtra.reply_markup = { inline_keyboard: [] };
  const params = Object.assign({ chat_id: source.chat.id, message_id: source.message_id, parse_mode: 'HTML' }, safeExtra);
  const isMedia = !!(source.photo || source.document || source.video || source.animation || source.audio || source.voice);
  try {
    await tg(env, isMedia ? 'editMessageCaption' : 'editMessageText', Object.assign(isMedia ? { caption: text } : { text: text }, params));
    return true;
  } catch (e) {
    if (String((e && e.message) || '').includes('message is not modified')) return true;
    try { await msg(env, source.chat.id, text, extra); } catch (e2) {}
    return false;
  }
}

async function ansCb(env, id, text, alert) {
  try {
    const p = { callback_query_id: id };
    if (text) { p.text = text; p.show_alert = !!alert; }
    await tg(env, 'answerCallbackQuery', p);
  } catch (e) {}
}

async function sendPhoto(env, chat_id, photo, caption, extra) {
  return tg(env, 'sendPhoto', Object.assign({
    chat_id: chat_id, photo: photo, caption: caption || '', parse_mode: 'HTML'
  }, telegramExtra(env, extra)));
}

// دریافت رسید مستقیم از Mini App و ارسال امن همان فایل به گفت‌وگوی ادمین‌ها؛ فایل در KV نگهداری نمی‌شود.
async function sendPhotoUpload(env, chat_id, photoFile, filename, caption, extra) {
  const form = new FormData();
  form.append('chat_id', String(chat_id));
  form.append('caption', caption || '');
  form.append('parse_mode', 'HTML');
  const safeExtra = telegramExtra(env, extra);
  if (safeExtra.reply_markup) form.append('reply_markup', JSON.stringify(safeExtra.reply_markup));
  form.append('photo', photoFile, filename || 'receipt.jpg');
  const r = await fetch('https://api.telegram.org/bot' + env.BOT_TOKEN + '/sendPhoto', { method: 'POST', body: form });
  let j = {};
  try { j = await r.json(); } catch (e) {}
  if (!j.ok) throw new Error('TG sendPhoto: ' + (j.description || ('HTTP ' + r.status)));
  return j.result;
}

function qrPngCrc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function qrPngU32(bytes, offset, value) {
  bytes[offset] = (value >>> 24) & 255;
  bytes[offset + 1] = (value >>> 16) & 255;
  bytes[offset + 2] = (value >>> 8) & 255;
  bytes[offset + 3] = value & 255;
}
function qrPngChunk(type, payload) {
  const tag = new TextEncoder().encode(type);
  const out = new Uint8Array(12 + payload.length);
  qrPngU32(out, 0, payload.length);
  out.set(tag, 4); out.set(payload, 8);
  qrPngU32(out, 8 + payload.length, qrPngCrc32(out.subarray(4, 8 + payload.length)));
  return out;
}
function qrPngJoin(parts) {
  const length = parts.reduce((n, part) => n + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}
function qrAdler32(bytes) {
  let a = 1, b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}
// zlib stream built from stored (uncompressed) deflate blocks: works even when CompressionStream is unavailable.
function qrZlibStored(bytes) {
  const blocks = Math.max(1, Math.ceil(bytes.length / 65535));
  const out = new Uint8Array(2 + blocks * 5 + bytes.length + 4);
  out[0] = 0x78; out[1] = 0x01; // zlib header (deflate, 32K window, no dictionary)
  let offset = 2, read = 0;
  for (let block = 0; block < blocks; block++) {
    const size = Math.min(65535, bytes.length - read);
    out[offset++] = block === blocks - 1 ? 1 : 0; // BFINAL + BTYPE=00 (stored)
    out[offset++] = size & 255; out[offset++] = (size >>> 8) & 255;
    out[offset++] = (~size) & 255; out[offset++] = ((~size) >>> 8) & 255;
    out.set(bytes.subarray(read, read + size), offset);
    offset += size; read += size;
  }
  const adler = qrAdler32(bytes);
  out[offset++] = (adler >>> 24) & 255; out[offset++] = (adler >>> 16) & 255;
  out[offset++] = (adler >>> 8) & 255; out[offset++] = adler & 255;
  return out;
}
async function qrDeflate(raw) {
  try {
    if (typeof CompressionStream === 'function') {
      const compressedStream = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'));
      const compressed = new Uint8Array(await new Response(compressedStream).arrayBuffer());
      if (compressed.length > 8) return compressed;
    }
  } catch (e) {}
  return qrZlibStored(raw);
}
async function subscriptionQrPng(link) {
  const value = String(link || '').trim();
  if (!value || value.length > 2900) throw new Error('invalid_qr_payload');
  let qr = qrcode(0, 'M');
  qr.addData(value, 'Byte');
  try { qr.make(); }
  catch (e) {
    // Long links can exceed the capacity of error-correction level M; retry with L before giving up.
    qr = qrcode(0, 'L');
    qr.addData(value, 'Byte');
    qr.make();
  }
  const modules = qr.getModuleCount();
  if (!modules || modules > 177) throw new Error('qr_payload_too_large');
  const scale = 8, quiet = 4, width = (modules + quiet * 2) * scale;
  const raw = new Uint8Array((width + 1) * width);
  const quietPixels = quiet * scale;
  for (let y = 0; y < width; y++) {
    const rowOffset = y * (width + 1);
    raw[rowOffset] = 0; // PNG filter: None
    const moduleY = y >= quietPixels && y < width - quietPixels ? Math.floor((y - quietPixels) / scale) : -1;
    for (let x = 0; x < width; x++) {
      const moduleX = x >= quietPixels && x < width - quietPixels ? Math.floor((x - quietPixels) / scale) : -1;
      raw[rowOffset + 1 + x] = moduleY >= 0 && moduleX >= 0 && qr.isDark(moduleY, moduleX) ? 0 : 255;
    }
  }
  const compressed = await qrDeflate(raw);
  const header = new Uint8Array(13);
  qrPngU32(header, 0, width); qrPngU32(header, 4, width);
  header[8] = 8;  // 8-bit grayscale
  header[9] = 0;  // grayscale color type
  header[10] = 0; header[11] = 0; header[12] = 0;
  return qrPngJoin([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    qrPngChunk('IHDR', header), qrPngChunk('IDAT', compressed), qrPngChunk('IEND', new Uint8Array(0))
  ]);
}
function qrPngBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 8192, bytes.length)));
  return btoa(binary);
}
async function subscriptionQrDataUrl(link) {
  const png = await subscriptionQrPng(link);
  return 'data:image/png;base64,' + qrPngBase64(png);
}
// QR is a nicety: never let QR generation break subscription delivery.
async function safeQrDataUrl(link) {
  try {
    const value = String(link || '');
    if (!value) return '';
    return await subscriptionQrDataUrl(value);
  } catch (e) { return ''; }
}
async function deliverSubscriptionWithQr(env, chatId, caption, link, extra) {
  try {
    const png = await subscriptionQrPng(link);
    await sendPhotoUpload(env, chatId, new Blob([png], { type: 'image/png' }), 'tiznetvpn-subscription-qr.png', caption, extra);
    return { sent: true, qr: true };
  } catch (e) {
    // Keep the subscription/link delivery working even if Telegram rejects the photo upload.
    try {
      await msg(env, chatId, caption, extra);
      try { await notifyAdmins(env, '⚠️ ارسال QR اشتراک به مشتری ناموفق بود، اما لینک متنی ارسال شد.'); } catch (e2) {}
      return { sent: true, qr: false };
    } catch (messageError) {
      try { await notifyAdmins(env, '⚠️ تحویل اشتراک به مشتری کامل نشد؛ سفارش تأیید و لینک ارسال نشد.'); } catch (e2) {}
      return { sent: false, qr: false };
    }
  }
}

async function sendDoc(env, chat_id, filename, content, caption, contentType) {
  const form = new FormData();
  form.append('chat_id', String(chat_id));
  form.append('caption', caption || '');
  form.append('parse_mode', 'HTML');
  const document = content instanceof Blob
    ? new Blob([content], { type: contentType || content.type || 'application/octet-stream' })
    : new Blob([String(content)], { type: contentType || 'text/plain' });
  form.append('document', document, filename);
  const r = await fetch('https://api.telegram.org/bot' + env.BOT_TOKEN + '/sendDocument', {
    method: 'POST', body: form
  });
  let j = {};
  try { j = await r.json(); } catch (e) {}
  if (!j.ok) throw new Error('TG sendDocument: ' + (j.description || ('HTTP ' + r.status)));
  return j.result;
}

async function notifyAdmins(env, text, extra) {
  const ids = adminIds(env);
  for (const id of ids) {
    try { await msg(env, id, text, extra); } catch (e) {}
  }
}

/* ============================ هیدیفای API v2 ============================ */

function trimSlash(s) { return String(s || '').replace(/\/+$/, ''); }

async function hreq(panel, method, path, body) {
  const url = trimSlash(panel.api_base) + '/api/v2/admin' + path;
  const r = await fetch(url, {
    method: method,
    headers: {
      'Hiddify-API-Key': panel.api_key,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const txt = await r.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = { raw: txt.slice(0, 300) }; }
  if (!r.ok) {
    const detail = data ? JSON.stringify(data).slice(0, 400) : ('HTTP ' + r.status);
    const error = new Error('Hiddify ' + r.status + ': ' + detail);
    error.status = r.status;
    throw error;
  }
  return data;
}

// فقط رد شدن فیلدها توسط پنل (۴۰۰/۴۲۲) قابل تلاش دوباره با payload ساده‌تر است.
// خطای شبکه، timeout یا ۵xx می‌تواند یعنی «یوزر ساخته شد ولی پاسخ گم شد»؛
// تلاش دوباره در آن حالت یوزر تکراری در Hiddify می‌سازد و پول مشتری دو بار مصرف می‌شود.
function hiddifyRejectedFields(error) {
  const status = Number(error && error.status);
  return status === 400 || status === 422;
}

// ساخت یوزر — با چند تلاش برای سازگاری با تفاوت‌های جزئی نسخه‌ها
async function hCreateUser(panel, f) {
  const full = {
    name: f.name,
    usage_limit_GB: Number(f.gb) || 0,
    package_days: Number(f.days) || 30,
    mode: 'no_reset',
    comment: f.comment || '',
    enable: true,
    start_date: todayStr()
  };
  const telegramId = Number(f.telegram_id);
  if (Number.isSafeInteger(telegramId) && telegramId > 0) full.telegram_id = telegramId;
  const tries = [
    full,
    { name: full.name, usage_limit_GB: full.usage_limit_GB, package_days: full.package_days, mode: 'no_reset', telegram_id: full.telegram_id, comment: full.comment },
    { name: full.name, usage_limit_GB: full.usage_limit_GB, package_days: full.package_days, telegram_id: full.telegram_id, comment: full.comment },
    { name: full.name, usage_limit_GB: full.usage_limit_GB, package_days: full.package_days }
  ];
  let lastErr = null;
  for (const t of tries) {
    try {
      const res = await hreq(panel, 'POST', '/user/', t);
      if (res && res.uuid) return res;
      // ۲xx بدون uuid: ساخت احتمالاً انجام شده است؛ تلاش دوباره یوزر تکراری می‌سازد.
      throw new Error('Hiddify: پاسخ بدون uuid برگشت');
    } catch (e) {
      lastErr = e;
      if (!hiddifyRejectedFields(e)) throw e;
    }
  }
  throw lastErr;
}

// تمدید/ویرایش یوزر — ریست مصرف + سقف و مدت جدید از امروز
async function hPatchUser(panel, uuid, f) {
  const full = {
    usage_limit_GB: Number(f.gb) || 0,
    package_days: Number(f.days) || 30,
    mode: 'no_reset',
    enable: true,
    start_date: todayStr(),
    current_usage_GB: 0
  };
  const tries = [
    full,
    { usage_limit_GB: full.usage_limit_GB, package_days: full.package_days, enable: true, start_date: full.start_date, current_usage_GB: 0 },
    { usage_limit_GB: full.usage_limit_GB, package_days: full.package_days, enable: true },
    { usage_limit_GB: full.usage_limit_GB, package_days: full.package_days }
  ];
  let lastErr = null;
  for (const t of tries) {
    try { return await hreq(panel, 'PATCH', '/user/' + uuid + '/', t); }
    catch (e) {
      lastErr = e;
      if (!hiddifyRejectedFields(e)) throw e;
    }
  }
  throw lastErr;
}

// گرفتن اطلاعات یوزر — اول مستقیم، اگر نشد با جستجو در لیست
async function hGetLive(panel, uuid) {
  try {
    return await hreq(panel, 'GET', '/user/' + uuid + '/');
  } catch (e) {
    if (String(e.message).indexOf('404') < 0) throw e;
  }
  const list = await hreq(panel, 'GET', '/user/');
  const arr = Array.isArray(list) ? list : (list && list.users ? list.users : []);
  const found = arr.find((x) => x && x.uuid === uuid);
  if (!found) throw new Error('Hiddify 404: یوزر در پنل پیدا نشد');
  return found;
}

async function hDeleteUser(panel, uuid) {
  return hreq(panel, 'DELETE', '/user/' + uuid + '/');
}

function freeSubscriptionPolicy(cfg) {
  const value = String(cfg && cfg.free_subscription_claim_policy || '');
  return ['once_lifetime', 'one_active', 'repeat'].includes(value) ? value : '';
}
function isFreeSubscription(sub) {
  return !!(sub && (sub.free_subscription === true || sub.kind === 'free_subscription' || sub.kind === 'referral_free_subscription'));
}
function isReferralFreeSubscription(sub) {
  return !!(sub && (sub.referral_reward === true || sub.kind === 'referral_free_subscription'));
}
async function hasEverFreeSubscription(env, user) {
  const tgId = String(user && user.tg_id || '');
  if (await kvGet(env, 'free_claimed:' + tgId, null)) return true;
  const ids = Array.isArray(user && user.subs) ? user.subs : [];
  for (const sid of ids.slice(-300).reverse()) {
    const sub = await getSub(env, String(sid));
    if (isFreeSubscription(sub) && !isReferralFreeSubscription(sub)) return true;
  }
  return ids.length > 300 ? null : false;
}
async function activeFreeSubscriptionState(env, user, panels) {
  const tgId = String(user && user.tg_id || '');
  let ids = [];
  const pointer = await kvGet(env, 'free_active:' + tgId, '');
  if (pointer) ids = [String(pointer)];
  else {
    const all = Array.isArray(user && user.subs) ? user.subs : [];
    if (all.length > 300) return { active: true, unknown: true };
    ids = all.slice().reverse().map(String);
  }
  for (const sid of ids) {
    const sub = await getSub(env, sid);
    if (!isFreeSubscription(sub) || isReferralFreeSubscription(sub)) continue;
    const panel = panels[String(sub.panel_id || '')];
    if (!panel || !sub.uuid) return { active: true, unknown: true };
    try {
      const live = await hGetLive(panel, sub.uuid);
      const remaining = planRemaining(live);
      if (live.is_active === false || live.enable === false || (remaining.days != null && remaining.days <= 0)) {
        if (String(pointer) === sid) await kvDel(env, 'free_active:' + tgId);
        continue;
      }
      await kvPut(env, 'free_active:' + tgId, sid);
      return { active: true, unknown: false, sid: sid };
    } catch (e) { return { active: true, unknown: true }; }
  }
  if (pointer) await kvDel(env, 'free_active:' + tgId);
  return { active: false, unknown: false };
}
async function miniAppFreeSubscriptionAvailability(env, user, cfg, panels) {
  const value = cfg || await getCfg(env);
  const panelMap = panels || await getPanels(env);
  const gb = Number(value.free_subscription_gb);
  const days = Number(value.free_subscription_days);
  const policy = freeSubscriptionPolicy(value);
  const result = {
    enabled: value.free_subscription_enabled === true,
    can_claim: false,
    gb: Number.isFinite(gb) && gb >= 0 ? gb : 1,
    days: Number.isInteger(days) && days > 0 ? days : 1,
    policy: policy,
    panel_name: '',
    reason: ''
  };
  if (!result.enabled) return result;
  const panel = panelMap[String(value.free_subscription_panel_id || '')];
  if (!panel || !isRecordEnabled(panel) || !panel.api_base || !panel.api_key || !panel.user_base) { result.enabled = false; result.reason = 'panel_unavailable'; return result; }
  result.panel_name = String(panel.name || '');
  if (!['once_lifetime', 'one_active', 'repeat'].includes(policy)) { result.reason = 'policy_unconfigured'; return result; }
  if (policy === 'once_lifetime') {
    const claimed = await hasEverFreeSubscription(env, user);
    if (claimed !== false) { result.reason = claimed === null ? 'status_unknown' : 'already_claimed'; return result; }
  } else if (policy === 'one_active') {
    const state = await activeFreeSubscriptionState(env, user, panelMap);
    if (state.active) { result.reason = state.unknown ? 'status_unknown' : 'already_active'; return result; }
  }
  result.can_claim = true;
  return result;
}
async function issueFreeSubscription(env, user, source) {
  const tgId = String(user && user.tg_id || '');
  if (!/^\d{1,20}$/.test(tgId)) return { ok: false, error: 'free_subscription_creation_failed' };
  const lockKey = 'free_subscription_lock:' + tgId;
  const held = await kvGet(env, lockKey, null);
  if (held && Date.now() - Number(held.created_at || 0) < 120000) return { ok: false, error: 'free_subscription_processing' };
  await kvPut(env, lockKey, { created_at: Date.now() }, 180);
  let panel = null;
  let created = null;
  let sid = '';
  let savedUser = false;
  try {
    const cfg = await getCfg(env);
    if (cfg.free_subscription_enabled !== true) return { ok: false, error: 'free_subscription_disabled' };
    const panels = await getPanels(env);
    panel = panels[String(cfg.free_subscription_panel_id || '')];
    if (!panel || !isRecordEnabled(panel) || !panel.api_base || !panel.api_key || !panel.user_base) return { ok: false, error: 'free_subscription_panel_unavailable' };
    const policy = freeSubscriptionPolicy(cfg);
    if (!['once_lifetime', 'one_active', 'repeat'].includes(policy)) return { ok: false, error: 'free_subscription_policy_unconfigured' };
    if (policy === 'once_lifetime') {
      const claimed = await hasEverFreeSubscription(env, user);
      if (claimed !== false) return { ok: false, error: claimed === null ? 'free_subscription_status_unknown' : 'free_subscription_already_claimed' };
    } else if (policy === 'one_active') {
      const state = await activeFreeSubscriptionState(env, user, panels);
      if (state.active) return { ok: false, error: state.unknown ? 'free_subscription_status_unknown' : 'free_subscription_already_active' };
    }
    const gb = Number(cfg.free_subscription_gb);
    const days = Number(cfg.free_subscription_days);
    if (!Number.isFinite(gb) || gb < 0 || gb > 1000000 || !Number.isInteger(days) || days < 1 || days > 3650) {
      return { ok: false, error: 'free_subscription_panel_unavailable' };
    }
    created = await hCreateUser(panel, {
      name: subName(tgId), gb: gb, days: days,
      telegram_id: Number(tgId), comment: 'TiznetVPN free subscription | ' + tgId
    });
    sid = uid(6);
    const sub = {
      sid: sid, uuid: created.uuid, panel_id: String(panel.id || cfg.free_subscription_panel_id),
      plan_id: '', plan_name: 'اشتراک رایگان', free_subscription: true,
      free_gb: gb, free_days: days, tg_id: tgId, order_id: null,
      created_at: Date.now(), reminded: '', expire_noticed: false
    };
    await saveSub(env, sub);
    user.subs = Array.isArray(user.subs) ? user.subs : [];
    user.subs.push(sid);
    await saveUser(env, user);
    savedUser = true;
    if (policy === 'once_lifetime') await kvPut(env, 'free_claimed:' + tgId, { sid: sid, created_at: Date.now() });
    if (policy === 'one_active') await kvPut(env, 'free_active:' + tgId, sid);
    await recordCustomerActivity(env, tgId, 'free_subscription_granted', { kind: String(source || 'unknown') }, 'free-' + sid);
    const link = userLink(panel, created.uuid);
    try {
      await notifyAdmins(env, '🎁 <b>اشتراک رایگان صادر شد</b>\n👤 <code>' + esc(tgId) + '</code>\n🖥 ' + esc(panel.name || 'سرور') + '\n📊 ' + (gb === 0 ? 'نامحدود' : fmtGB(gb)) + ' · ⏳ ' + faNum(days) + ' روز');
    } catch (e) {}
    return { ok: true, sid: sid, link: link, qr_data_url: await safeQrDataUrl(link), panel_name: String(panel.name || 'سرور'), gb: gb, days: days };
  } catch (e) {
    if (sid) {
      try { await kvDel(env, 's:' + sid); } catch (e2) {}
      if (savedUser) {
        user.subs = (Array.isArray(user.subs) ? user.subs : []).filter((value) => String(value) !== sid);
        try { await saveUser(env, user); } catch (e2) {}
      }
      try { await kvDel(env, 'free_claimed:' + tgId); await kvDel(env, 'free_active:' + tgId); } catch (e2) {}
    }
    if (created && panel && created.uuid) { try { await hDeleteUser(panel, created.uuid); } catch (e2) {} }
    try { await notifyAdmins(env, '⚠️ صدور اشتراک رایگان برای <code>' + esc(tgId) + '</code> ناموفق بود.'); } catch (e2) {}
    return { ok: false, error: 'free_subscription_creation_failed' };
  } finally {
    await kvDel(env, lockKey);
  }
}

async function issueReferralFreeSubscription(env, user, source) {
  const tgId = String(user && user.tg_id || '');
  if (!/^\d{1,20}$/.test(tgId)) return { ok: false, error: 'referral_reward_creation_failed' };
  const lockKey = 'referral_free_reward_lock:' + tgId;
  const held = await kvGet(env, lockKey, null);
  if (held && Date.now() - Number(held.started_at || 0) < 180000) return { ok: false, error: 'referral_reward_processing' };
  await kvPut(env, lockKey, { started_at: Date.now(), source: String(source || '') }, 240);
  let panel = null, created = null, sid = '', savedUser = false, workingUser = null;
  let previousClaimed = 0, previousSubs = [];
  const rewardRecordKey = 'referral_free_reward:' + tgId + ':';
  let claimIndex = 0;
  try {
    workingUser = await getUser(env, tgId) || user;
    const state = referralInviteState(workingUser);
    if (state.available < 1) return { ok: false, error: 'referral_reward_not_ready', joined_count: state.joined, progress: state.progress };
    const cfg = await getCfg(env);
    const panels = await getPanels(env);
    panel = panels[String(cfg.free_subscription_panel_id || '')];
    if (!panel || !isRecordEnabled(panel) || !panel.api_base || !panel.api_key || !panel.user_base) return { ok: false, error: 'referral_reward_panel_unavailable' };
    claimIndex = state.claimed + 1;
    previousClaimed = state.claimed;
    previousSubs = Array.isArray(workingUser.subs) ? workingUser.subs.slice() : [];
    const eventKey = rewardRecordKey + claimIndex;
    const existingEvent = await kvGet(env, eventKey, null);
    if (existingEvent) {
      workingUser.referral_free_rewards_claimed = Math.max(previousClaimed, claimIndex);
      await saveUser(env, workingUser);
      const existingSub = existingEvent.sid ? await getSub(env, existingEvent.sid) : null;
      if (existingSub && existingSub.uuid) {
        const existingLink = userLink(panel, existingSub.uuid);
        return { ok: true, kind: 'referral_reward', sid: String(existingSub.sid), link: existingLink, qr_data_url: await safeQrDataUrl(existingLink), panel_name: String(panel.name || ''), gb: 3, days: 3, duplicate: true };
      }
      return { ok: false, error: 'referral_reward_already_claimed' };
    }
    created = await hCreateUser(panel, {
      name: subName(tgId), gb: 3, days: 3,
      telegram_id: Number(tgId), comment: 'TiznetVPN referral reward | ' + tgId
    });
    sid = uid(6);
    const sub = {
      sid: sid, uuid: created.uuid, panel_id: String(panel.id || cfg.free_subscription_panel_id),
      plan_id: '', plan_name: 'هدیهٔ دعوت · ۳ گیگ · ۳ روز', free_subscription: true,
      kind: 'referral_free_subscription', referral_reward: true, free_gb: 3, free_days: 3,
      tg_id: tgId, order_id: null, created_at: Date.now(), reminded: '', expire_noticed: false
    };
    await saveSub(env, sub);
    workingUser.subs = previousSubs.concat([sid]);
    workingUser.referral_free_rewards_claimed = claimIndex;
    await saveUser(env, workingUser);
    savedUser = true;
    await kvPut(env, eventKey, { sid: sid, created_at: Date.now(), source: String(source || 'unknown'), group: claimIndex });
    await recordCustomerActivity(env, tgId, 'referral_free_subscription_granted', { kind: String(source || 'unknown'), sid: sid }, 'referral-free-' + sid);
    const link = userLink(panel, created.uuid);
    try { await notifyAdmins(env, '🎁 <b>هدیهٔ دعوت صادر شد</b>\n👤 <code>' + esc(tgId) + '</code>\n🖥 ' + esc(panel.name || 'سرور') + '\n📊 ۳ گیگ · ⏳ ۳ روز'); } catch (e) {}
    return { ok: true, kind: 'referral_reward', sid: sid, link: link, qr_data_url: await safeQrDataUrl(link), panel_name: String(panel.name || 'سرور'), gb: 3, days: 3, rewards_remaining: Math.max(0, state.available - 1) };
  } catch (e) {
    if (sid) { try { await kvDel(env, 's:' + sid); } catch (e2) {} }
    if (savedUser && workingUser) {
      workingUser.subs = previousSubs;
      workingUser.referral_free_rewards_claimed = previousClaimed;
      try { await saveUser(env, workingUser); } catch (e2) {}
    }
    if (claimIndex) { try { await kvDel(env, rewardRecordKey + claimIndex); } catch (e2) {} }
    if (created && panel && created.uuid) { try { await hDeleteUser(panel, created.uuid); } catch (e2) {} }
    try { await notifyAdmins(env, '⚠️ صدور هدیهٔ دعوت برای <code>' + esc(tgId) + '</code> ناموفق بود.'); } catch (e2) {}
    return { ok: false, error: 'referral_reward_creation_failed' };
  } finally { await kvDel(env, lockKey); }
}

async function redeemReferralPoints(env, user) {
  const tgId = String(user && user.tg_id || '');
  if (!/^\d{1,20}$/.test(tgId)) return { data: { ok: false, error: 'referral_points_invalid_user' }, status: 400 };
  const lockKey = 'referral_balance_lock:' + tgId;
  const held = await kvGet(env, lockKey, null);
  if (held && Date.now() - Number(held.started_at || 0) < 30000) return { data: { ok: false, error: 'referral_points_redeem_processing' }, status: 409 };
  await kvPut(env, lockKey, { started_at: Date.now() }, 60);
  try {
    const current = await getUser(env, tgId);
    if (!current) return { data: { ok: false, error: 'customer_not_found' }, status: 404 };
    const points = Math.max(0, Math.floor(Number(current.referral_points_balance || 0)));
    const blocks = Math.floor(points / 100);
    if (blocks < 1) return { data: { ok: false, error: 'referral_points_insufficient', points_balance: points }, status: 409 };
    const pointsToRedeem = blocks * 100;
    const credit = blocks * 200000;
    if (!Number.isSafeInteger(credit) || credit < 200000) return { data: { ok: false, error: 'referral_points_invalid_amount' }, status: 400 };
    current.referral_points_balance = points - pointsToRedeem;
    current.referral_points_redeemed_total = Math.max(0, Math.floor(Number(current.referral_points_redeemed_total || 0))) + pointsToRedeem;
    current.referral_wallet_credited_total = Math.max(0, Math.floor(Number(current.referral_wallet_credited_total || 0))) + credit;
    current.balance = Number(current.balance || 0) + credit;
    await saveUser(env, current);
    const ledgerId = 'ref-points-' + uid(12);
    await recordLedgerSafely(env, {
      id: ledgerId, kind: 'wallet_adjustment', type: 'referral_points', tg_id: tgId,
      amount: credit, payment_method: 'referral_points', description: 'تبدیل ' + faNum(pointsToRedeem) + ' امتیاز عضوگیری',
      points_redeemed: pointsToRedeem, balance_after: current.balance, occurred_at: Date.now()
    });
    await recordCustomerActivity(env, tgId, 'referral_points_redeemed', { points: pointsToRedeem, amount: credit }, ledgerId);
    try { await msg(env, tgId, '✅ <b>امتیاز عضوگیری به کیف پول تبدیل شد.</b>\n⭐ امتیاز مصرف‌شده: ' + faNum(pointsToRedeem) + '\n💰 شارژ کیف پول: ' + fmtToman(credit) + '\n⭐ امتیاز باقی‌مانده: ' + faNum(current.referral_points_balance)); } catch (e) {}
    return { data: { ok: true, points_redeemed: pointsToRedeem, credited: credit, points_balance: current.referral_points_balance, wallet_balance: current.balance }, status: 200 };
  } catch (e) {
    return { data: { ok: false, error: 'referral_points_redeem_failed' }, status: 500 };
  } finally { await kvDel(env, lockKey); }
}

async function deleteCustomerSubscription(env, tgId, sid) {
  const ownerId = String(tgId || '');
  const subscriptionId = String(sid || '').slice(0, 40);
  const sub = subscriptionId ? await getSub(env, subscriptionId) : null;
  if (!sub || String(sub.tg_id) !== ownerId) return { ok: false, status: 404, error: 'subscription_not_found' };
  const lockKey = 'subscription_delete_lock:' + subscriptionId;
  const held = await kvGet(env, lockKey, null);
  if (held && Date.now() - Number(held.created_at || 0) < 30000) return { ok: false, status: 409, error: 'subscription_delete_processing' };
  await kvPut(env, lockKey, { created_at: Date.now(), tg_id: ownerId }, 60);
  try {
    const pendingIds = await kvGet(env, 'pend', []);
    for (const id of (Array.isArray(pendingIds) ? pendingIds : []).slice(-100).reverse()) {
      const order = await getOrder(env, id);
      if (order && order.status === 'pending' && String(order.tg_id) === ownerId && String(order.sub_sid || '') === subscriptionId) {
        return { ok: false, status: 409, error: 'subscription_has_pending_order' };
      }
    }
    const panels = await getPanels(env);
    const panel = panels[String(sub.panel_id || '')];
    if (!panel || !panel.api_base || !sub.uuid) return { ok: false, status: 503, error: 'subscription_panel_unavailable' };
    try { await hDeleteUser(panel, sub.uuid); }
    catch (e) {
      // A previous delete may have reached Hiddify even if the client did not receive the response.
      if (!/\b404\b/.test(String((e && e.message) || e))) {
        return { ok: false, status: 502, error: 'subscription_delete_failed' };
      }
    }
    const user = await getUser(env, ownerId);
    if (!user) return { ok: false, status: 404, error: 'customer_not_found' };
    await delSub(env, subscriptionId);
    user.subs = (Array.isArray(user.subs) ? user.subs : []).filter((value) => String(value) !== subscriptionId);
    await saveUser(env, user);
    if (isFreeSubscription(sub) && String(await kvGet(env, 'free_active:' + ownerId, '')) === subscriptionId) await kvDel(env, 'free_active:' + ownerId);
    await recordCustomerActivity(env, ownerId, 'subscription_deleted', { kind: 'subscription' }, 'delete-' + subscriptionId);
    return { ok: true, status: 200 };
  } finally {
    await kvDel(env, lockKey);
  }
}

async function hTest(panel) {
  return hreq(panel, 'GET', '/me/');
}

async function hStatus(panel) {
  return hreq(panel, 'GET', '/server_status/');
}

function userLink(panel, uuid) {
  return trimSlash(panel.user_base) + '/' + uuid + '/';
}

// تلاش برای گرفتن همه کانفیگ‌ها (best-effort — اگر پنل نداد، null)
async function tryFetchConfigs(panel, uuid) {
  try {
    const r = await fetch(trimSlash(panel.user_base) + '/' + uuid + '/all-configs/', {
      method: 'GET', headers: { 'Accept': 'text/plain' }
    });
    if (!r.ok) return null;
    const t = await r.text();
    if (!t || t.length < 50) return null;
    if (t.indexOf('://') < 0) return null;
    return t.slice(0, 60000);
  } catch (e) { return null; }
}

/* ============================ متن‌ها ============================ */

function helpText() {
  return '📖 <b>راهنمای استفاده از تیزنت VPN</b>\n\n' +
    '1️⃣ اپ <b>Hiddify</b> را نصب کنید (دکمه دانلود اپ‌ها 👇).\n' +
    '2️⃣ در ربات، از بخش «اشتراک‌های من» وارد اشتراک شوید و <b>لینک اشتراک</b> را کپی کنید.\n' +
    '3️⃣ در اپ Hiddify گزینه <b>افزودن از لینک / Add from URL</b> را بزنید و لینک را وارد کنید.\n' +
    '4️⃣ دکمه اتصال را بزنید و لذت ببرید! 🎉\n\n' +
    '💡 اگر لینک کار نکرد، «صفحه کاربری» را در مرورگر باز کنید و کانفیگ‌ها را دستی اضافه کنید.\n' +
    '💡 مصرف و روزهای باقی‌مانده را همیشه از «اشتراک‌های من» ببینید.';
}

function appsText() {
  return '📥 <b>دانلود اپ Hiddify برای اتصال به تیزنت VPN</b>\n\n' +
    '🤖 <b>اندروید:</b>\n' +
    '• گوگل‌پلی: <code>https://play.google.com/store/apps/details?id=app.hiddify.com</code>\n\n' +
    '🍎 <b>آیفون:</b>\n' +
    '• اپ‌استور: <code>https://apps.apple.com/us/app/hiddify-proxy-vpn/id6596777532</code>\n\n' +
    '💻 <b>ویندوز:</b>\n' +
    '• مایکروسافت‌استور: <code>https://apps.microsoft.com/detail/9pdfnl3qv2s5</code>\n\n' +
    '📦 <b>همه نسخه‌ها (گیت‌هاب):</b>\n' +
    '<code>https://github.com/hiddify/hiddify-app/releases</code>';
}

function supportText(cfg) {
  if (cfg.support) {
    const s = String(cfg.support).replace(/^@/, '');
    return '📞 <b>پشتیبانی تیزنت VPN</b>\n\nبرای کمک پیام بدید:\n👉 @' + esc(s) + '\n🔗 https://t.me/' + esc(s);
  }
  return '📞 <b>پشتیبانی تیزنت VPN</b>\n\nبه‌زودی راه ارتباطی اینجا قرار می‌گیرد.';
}

function planLine(p) {
  const gb = Number(p.gb) === 0 ? '♾ نامحدود' : (p.gb + ' گیگ');
  return esc(p.title) + ' | ' + gb + ' | ' + faNum(p.days) + ' روز | ' + fmtToman(p.price);
}

function orderTypeFa(t) {
  return t === 'buy' ? 'خرید جدید' : t === 'renew' ? 'تمدید' : t === 'charge' ? 'شارژ کیف پول' : t;
}

/* ============================ منوی اصلی ============================ */

async function showHome(env, chatId, u, messageId, origin, allowWebApp) {
  const cfg = await getCfg(env);
  const text = '✨ <b>تیزنت VPN | TiznetVPN</b>\n' + esc(cfg.welcome) +
    '\n\n💰 موجودی کیف پول: <b>' + fmtToman(u.balance) + '</b>';
  const rows = [
    [BTN('🛍 خرید اشتراک', 'buy'), BTN('📦 اشتراک‌های من', 'mysubs')],
    [BTN('💰 کیف پول / شارژ', 'wallet'), BTN('🎁 دعوت دوستان', 'ref')],
    [BTN('📖 راهنما', 'help'), BTN('📥 دانلود اپ‌ها', 'apps')],
    [BTN('📞 پشتیبانی', 'sup')]
  ];
  const appUrl = allowWebApp === false ? '' : miniAppUrl(env, origin);
  if (appUrl) rows.unshift([WEBAPPBTN('ورود به اپ', appUrl)]);
  const kb = KB(rows);
  if (messageId) await editMsg(env, chatId, messageId, text, kb);
  else await msg(env, chatId, text, kb);
}

async function showMiniAppOnlyStart(env, chatId, origin) {
  const appUrl = miniAppUrl(env, origin);
  const appButton = appUrl ? KB([[WEBAPPBTN('ورود به اپ', appUrl)]]) : undefined;
  await msg(env, chatId, 'جهت خرید وارد اپ فروش شوید.', appButton);
  await msg(env, chatId, 'برای سایر خدمات، یکی از دکمه‌های پایین چت را انتخاب کنید.', mainBotReplyMarkup());
}

async function sendMiniAppEntry(env, chatId, origin, caption) {
  const appUrl = miniAppUrl(env, origin);
  const extra = appUrl ? KB([[WEBAPPBTN('ورود به اپ', appUrl)]]) : undefined;
  await msg(env, chatId, caption || 'برای ادامه وارد اپ فروش تیزنت شوید.', extra);
}

function miniOnlyFreeError(error) {
  const messages = {
    free_subscription_disabled: 'اشتراک رایگان در حال حاضر توسط مدیریت غیرفعال است.',
    free_subscription_panel_unavailable: 'سرور اشتراک رایگان در دسترس نیست؛ لطفاً بعداً دوباره بررسی کنید.',
    free_subscription_already_claimed: 'این حساب قبلاً اشتراک رایگان خود را دریافت کرده است.',
    free_subscription_already_active: 'برای حساب شما یک اشتراک رایگان فعال وجود دارد.',
    free_subscription_status_unknown: 'وضعیت اشتراک رایگان قبلی مشخص نشد؛ برای جلوگیری از ساخت دوباره، با پشتیبانی تماس بگیرید.',
    free_subscription_processing: 'درخواست قبلی هنوز در حال پردازش است؛ چند لحظه دیگر دوباره بررسی کنید.',
    free_subscription_policy_unconfigured: 'سیاست دریافت اشتراک رایگان توسط مدیریت تنظیم نشده است؛ لطفاً بعداً دوباره بررسی کنید.',
    free_subscription_creation_failed: 'صدور اشتراک رایگان ناموفق بود؛ لطفاً با پشتیبانی تماس بگیرید.',
    referral_reward_not_ready: 'هنوز سه عضو جدید از طریق لینک شما وارد نشده‌اند؛ پاداش در اپ برایتان نمایش داده می‌شود.',
    referral_reward_panel_unavailable: 'سرور هدیهٔ دعوت در دسترس نیست یا هنوز در تنظیمات مشخص نشده است؛ لطفاً بعداً دوباره بررسی کنید.',
    referral_reward_processing: 'درخواست هدیهٔ دعوت شما در حال پردازش است؛ چند لحظه دیگر دوباره بررسی کنید.',
    referral_reward_already_claimed: 'این هدیه قبلاً دریافت شده است.',
    referral_reward_creation_failed: 'صدور هدیهٔ دعوت ناموفق بود؛ لطفاً با پشتیبانی تماس بگیرید.'
  };
  return messages[String(error || '')] || 'درخواست کامل نشد؛ لطفاً با پشتیبانی تماس بگیرید.';
}

async function handleMiniAppOnlyButton(env, u, chatId, text, origin) {
  const cfg = await getCfg(env);
  if (text === 'خرید اشتراک') {
    await sendMiniAppEntry(env, chatId, origin, 'برای خرید اشتراک وارد اپ فروش تیزنت شوید.');
    return true;
  }
  if (text === 'پشتیبانی') {
    const support = String(cfg.support || '').trim().replace(/^@/, '');
    const body = support
      ? 'برای پشتیبانی به <a href="https://t.me/' + esc(support) + '">@' + esc(support) + '</a> پیام دهید.'
      : 'شناسهٔ پشتیبانی هنوز در تنظیمات فروشگاه ثبت نشده است.';
    await msg(env, chatId, body, mainBotReplyMarkup());
    return true;
  }
  if (text === 'اشتراک رایگان') {
    const referralState = referralInviteState(await getUser(env, u.tg_id) || u);
    const referralClaim = referralState.available > 0;
    const result = referralClaim
      ? await issueReferralFreeSubscription(env, u, 'bot')
      : await issueFreeSubscription(env, u, 'bot');
    if (!result.ok) {
      await msg(env, chatId, miniOnlyFreeError(result.error), mainBotReplyMarkup());
      return true;
    }
    const title = referralClaim ? '🎁 <b>هدیهٔ دعوت شما فعال شد.</b>' : '🎁 <b>اشتراک رایگان شما فعال شد.</b>';
    const caption = title + '\n\n🖥 سرور: <b>' + esc(result.panel_name) + '</b>' +
      '\n📊 حجم: <b>' + (Number(result.gb) === 0 ? 'نامحدود' : fmtGB(result.gb)) + '</b>' +
      '\n⏳ مدت: <b>' + faNum(result.days) + ' روز</b>' +
      '\n\n🔗 لینک اشتراک:\n<code>' + esc(result.link) + '</code>';
    await deliverSubscriptionWithQr(env, chatId, caption, result.link, mainBotReplyMarkup());
    return true;
  }
  if (text === 'راهنما') {
    await msg(env, chatId, '📖 <b>راهنما</b>\n\nبرای خرید، «خرید اشتراک» را بزنید و در اپ تیزنت پلن و روش پرداخت را انتخاب کنید.\nبرای دریافت دسترسی رایگان، «اشتراک رایگان» را انتخاب کنید؛ صدور آن به فعال‌بودن گزینه در تنظیمات مدیریت بستگی دارد.\nبرای مشاهدهٔ وضعیت و سابقهٔ حساب، «اطلاعات حساب» یا اپ تیزنت را باز کنید.', mainBotReplyMarkup());
    return true;
  }
  if (text === 'اطلاعات حساب') {
    const joined = Number(u.joined_at) ? new Date(Number(u.joined_at)).toLocaleDateString('fa-IR', { timeZone: 'Asia/Tehran' }) : '—';
    const message = '👤 <b>اطلاعات حساب</b>\n\n' +
      'نام: <b>' + esc(u.first_name || '—') + '</b>' +
      '\nنام کاربری: <b>' + (u.username ? '@' + esc(u.username) : 'ثبت نشده') + '</b>' +
      '\nشناسهٔ تلگرام: <code>' + esc(u.tg_id) + '</code>' +
      '\nعضویت: <b>' + esc(joined) + '</b>' +
      '\nکیف پول: <b>' + fmtToman(u.balance) + '</b>' +
      '\nمجموع خرید ثبت‌شده: <b>' + fmtToman(u.total_spent || 0) + '</b>' +
      '\nاشتراک‌های ثبت‌شده: <b>' + faNum(Array.isArray(u.subs) ? u.subs.length : 0) + '</b>' +
      '\nدعوت‌ها: <b>' + faNum(u.invited || 0) + '</b>';
    await msg(env, chatId, message, mainBotReplyMarkup());
    return true;
  }
  if (text === 'دریافت نمایندگی') {
    const current = await ensureReferralCode(env, await getUser(env, u.tg_id) || u);
    const botName = await ensureBotUsername(env, cfg);
    const link = botName ? 'https://t.me/' + String(botName).replace(/^@/, '') + '?start=ref_' + current.ref_code : '—';
    const inviteState = referralInviteState(current);
    const message = '🤝 <b>اطلاعات دعوت دوستان</b>\n\n' +
      'لینک اختصاصی شما:\n<code>' + esc(link) + '</code>' +
      '\n\n👥 اعضای جذب‌شده: <b>' + faNum(inviteState.joined) + '</b>' +
      '\n⭐ امتیاز فعلی: <b>' + faNum(current.referral_points_balance || 0) + '</b>' +
      '\n⭐ هر عضو جدید: <b>۵ امتیاز</b> · خرید موفق زیرمجموعه: <b>۱۰ امتیاز</b>' +
      '\n🎁 پاداش تکرارشونده: هر ۳ عضو جدید، یک اشتراک ۳ گیگ / ۳ روز' +
      '\n💳 تبدیل دستی در اپ: هر ۱۰۰ امتیاز = ۲۰۰٬۰۰۰ تومان؛ امتیاز باقی‌مانده حفظ می‌شود.' +
      '\n💰 پورسانت خریدهای واجد شرایط: <b>' + faNum(cfg.commission) + '٪</b>';
    await msg(env, chatId, message, mainBotReplyMarkup());
    return true;
  }
  return false;
}

/* ============================ خرید ============================ */

function isRecordEnabled(record) {
  if (!record || record.archived === true || String(record.archived).toLowerCase() === 'true') return false;
  const value = record.enabled;
  return !(value === false || value === 0 || String(value).toLowerCase() === 'false' || String(value) === '0');
}

function enabledPanels(panels) {
  return Object.values(panels || {}).filter(isRecordEnabled);
}

function normalisePlanPanelIds(plan) {
  if (!plan) return [];
  const raw = plan.panel_ids;
  let assigned = [];
  if (Array.isArray(raw)) assigned = raw.map(String);
  else if (typeof raw === 'string') {
    const text = raw.trim();
    let parsedArray = false;
    if (text.startsWith('[')) {
      try { const parsed = JSON.parse(text); if (Array.isArray(parsed)) { assigned = parsed.map(String); parsedArray = true; } } catch (e) {}
    }
    if (!parsedArray) assigned = text.split(/[,\s]+/).filter(Boolean);
  } else if (raw && typeof raw === 'object') {
    assigned = Object.entries(raw).filter(([, value]) => value !== false && value !== 0 && String(value).toLowerCase() !== 'false').map(([key]) => key);
  }
  return Array.from(new Set(assigned.map((id) => String(id).trim()).filter(Boolean)));
}

function planAssignedToPanel(plan, panelId) {
  if (!plan) return false;
  const assigned = normalisePlanPanelIds(plan);
  // پلن‌های قدیمی که هنوز panel_ids ندارند برای همهٔ سرورهای فعال قابل فروش می‌مانند.
  if (!assigned.length) return true;
  return assigned.some((id) => id === 'all' || id === String(panelId) || id.toLowerCase() === String(panelId).toLowerCase());
}

function plansForPanel(plans, pid) {
  return Object.values(plans || {})
    .filter((p) => isRecordEnabled(p) && planAssignedToPanel(p, pid))
    .sort((a, b) => a.price - b.price);
}

async function showPanels(env, chatId, messageId) {
  const panels = enabledPanels(await getPanels(env));
  if (!panels.length) {
    const t = '😔 در حال حاضر سرور فعالی برای فروش وجود ندارد.\nلطفاً بعداً تلاش کنید یا به پشتیبانی پیام بدید.';
    if (messageId) await editMsg(env, chatId, messageId, t, KB([[BTN('◀️ برگشت', 'home')]]));
    else await msg(env, chatId, t, KB([[BTN('◀️ برگشت', 'home')]]));
    return;
  }
  const rows = panels.map((p) => [BTN('🖥 ' + p.name, 'bp:' + p.id)]);
  rows.push([BTN('◀️ برگشت', 'home')]);
  const t = '🖥 <b>انتخاب لوکیشن سرور:</b>';
  if (messageId) await editMsg(env, chatId, messageId, t, KB(rows));
  else await msg(env, chatId, t, KB(rows));
}

async function showPlans(env, chatId, messageId, pid, sid) {
  // sid خالی یعنی خرید جدید، وگرنه تمدید اشتراک sid
  const panels = await getPanels(env);
  const panel = panels[pid];
  if (!panel) { await msg(env, chatId, '❌ این سرور دیگر فعال نیست.', KB([[BTN('◀️ برگشت', 'home')]])); return; }
  const list = plansForPanel(await getPlans(env), pid);
  if (!list.length) {
    const t = '😔 برای این سرور پلن فعالی تعریف نشده.';
    const back = sid ? 'sub:' + sid : 'buy';
    if (messageId) await editMsg(env, chatId, messageId, t, KB([[BTN('◀️ برگشت', back)]]));
    else await msg(env, chatId, t, KB([[BTN('◀️ برگشت', back)]]));
    return;
  }
  const rows = list.map((p) => [BTN((Number(p.gb) === 0 ? '♾ ' : '📦 ') + p.title + ' | ' + (Number(p.gb) === 0 ? 'نامحدود' : p.gb + 'G') + ' | ' + p.days + 'روز | ' + Number(p.price).toLocaleString('en-US'), (sid ? 'rp:' + sid + ':' : 'bl:' + pid + ':') + p.id)]);
  rows.push([BTN('◀️ برگشت', sid ? 'sub:' + sid : 'buy')]);
  const t = '🖥 سرور: <b>' + esc(panel.name) + '</b>\n📦 <b>انتخاب پلن:</b>';
  if (messageId) await editMsg(env, chatId, messageId, t, KB(rows));
  else await msg(env, chatId, t, KB(rows));
}

async function showPlanDetail(env, chatId, messageId, u, pid, plid, sid) {
  const panels = await getPanels(env);
  const plans = await getPlans(env);
  const panel = panels[pid];
  const plan = plans[plid];
  if (!panel || !plan) { await ansCb(env, 0, ''); return; }
  const isRenew = !!sid;
  const canWallet = u.balance >= plan.price;
  const t = (isRenew ? '🔄 <b>تمدید اشتراک</b>' : '🛍 <b>تأیید خرید</b>') +
    '\n\n🖥 سرور: <b>' + esc(panel.name) + '</b>' +
    '\n📦 پلن: <b>' + esc(plan.title) + '</b>' +
    '\n📊 حجم: <b>' + (Number(plan.gb) === 0 ? '♾ نامحدود' : fmtGB(plan.gb)) + '</b>' +
    '\n⏳ مدت: <b>' + faNum(plan.days) + ' روز</b>' +
    '\n💵 مبلغ: <b>' + fmtToman(plan.price) + '</b>' +
    '\n💰 موجودی شما: <b>' + fmtToman(u.balance) + '</b>' +
    (isRenew ? '\n\n⚠️ با تمدید، مصرف قبلی صفر و حجم و مدت جدید از امروز اعمال می‌شود.' : '');
  const pre = isRenew ? 'r' : '';
  const idp = isRenew ? sid : pid;
  const rows = [];
  rows.push([BTN(canWallet ? '💰 پرداخت با کیف پول (تحویل فوری ⚡)' : '💰 موجودی کیف پول کافی نیست', canWallet ? pre + 'payw:' + idp + ':' + plid : 'noop')]);
  const cfg = await getCfg(env);
  if (cfg.card_auto_enabled === true && cfg.card_number && env.SHETAB_API_SECRET) {
    rows.push([BTN('⚡ کارت‌به‌کارت خودکار (تحویل فوری)', pre + 'payx:' + idp + ':' + plid)]);
  }
  if (cfg.card_manual_enabled !== false && cfg.card_number) {
    rows.push([BTN('💳 کارت‌به‌کارت دستی', pre + 'payc:' + idp + ':' + plid)]);
  }
  rows.push([BTN('◀️ برگشت', isRenew ? 'rnw:' + sid : 'bp:' + pid)]);
  if (messageId) await editMsg(env, chatId, messageId, t, KB(rows));
  else await msg(env, chatId, t, KB(rows));
}

async function cardPayStart(env, chatId, u, kind, a, b) {
  // kind: buy → a=pid b=plid | renew → a=sid b=plid | charge → a=amount
  const cfg = await getCfg(env);
  if (cfg.card_manual_enabled === false) {
    await msg(env, chatId, '❌ کارت‌به‌کارت دستی توسط ادمین غیرفعال شده است.', KB([[BTN('◀️ برگشت', 'home')]]));
    return;
  }
  if (!cfg.card_number) {
    await msg(env, chatId, '❌ روش کارت‌به‌کارت هنوز توسط ادمین تنظیم نشده. لطفاً با پشتیبانی در تماس باشید.', KB([[BTN('◀️ برگشت', 'home')]]));
    return;
  }
  const plans = await getPlans(env);
  let amount, desc;
  if (kind === 'charge') {
    amount = Number(a);
    desc = 'شارژ کیف پول';
  } else {
    const plan = plans[b];
    if (!plan) return;
    amount = plan.price;
    desc = (kind === 'renew' ? 'تمدید اشتراک' : 'خرید اشتراک') + ' «' + plan.title + '»';
  }
  const rialAmount = rialFromToman(amount);
  const t = '💳 <b>پرداخت کارت‌به‌کارت</b>\n\n' +
    '🧾 بابت: ' + esc(desc) +
    '\n💵 مبلغ سفارش (تومان): <b>' + fmtToman(amount) + '</b>' +
    '\n🏦 مبلغ برای فیلد ریالی بانک: <b>' + fmtRialFromToman(amount) + '</b>' +
    '\n<i>اگر اپ بانکی مبلغ را به تومان می‌خواهد، مبلغ تومان را وارد کنید؛ اگر ریال می‌خواهد، دکمهٔ کپی ریال را بزنید.</i>' +
    '\n\n💳 شماره کارت:\n<code>' + esc(String(cfg.card_number).replace(/\s/g, '')) + '</code>' +
    (cfg.card_holder ? '\n👤 به‌نام: ' + esc(cfg.card_holder) : '') +
    '\n\n✅ بعد از واریز، <b>عکس رسید یا شماره پیگیری</b> را همین‌جا ارسال کنید تا سفارش شما ثبت و برای ادمین ارسال شود.' +
    '\n⏳ معمولاً در کمتر از چند ساعت تأیید می‌شود.';
  await setState(env, u.tg_id, kind === 'charge' ? 'chg_rcp' : 'rcp',
    kind === 'charge' ? { amount: amount } : { kind: kind, a: a, b: b });
  await msg(env, chatId, t, KB([
    [COPYBTN('📋 کپی مبلغ ریالی', rialAmount)],
    [BTN('❌ انصراف', 'home')]
  ]));
}

// تخصیص مبلغ یکتا برای کارت‌به‌کارت خودکار (واحد: تومان؛ فقط ۱۰ تا ۹۹۹ تومان بالاتر از مبلغ پایه)
async function reserveShetabAmount(env, baseAmount, orderId) {
  const pending = await kvGet(env, 'pend', []);
  const activeAmounts = new Set();
  for (const id of pending) {
    const o = await getOrder(env, id);
    if (o && o.payment_method === 'shetab' && o.pay_amount != null) activeAmounts.add(Number(o.pay_amount));
  }
  const minSuffix = 10;
  const maxSuffix = 999;
  const suffixCount = maxSuffix - minSuffix + 1;
  const start = Math.floor(Math.random() * suffixCount);
  for (let i = 0; i < suffixCount; i++) {
    const suffix = minSuffix + ((start + i) % suffixCount);
    const candidate = Number(baseAmount) + suffix;
    if (activeAmounts.has(candidate)) continue;
    const reserved = await kvGet(env, 'shetab_amt:' + candidate, null);
    if (reserved) continue;
    await kvPut(env, 'shetab_amt:' + candidate, { order_id: orderId, created_at: Date.now() }, SHETAB_AMOUNT_TTL);
    return candidate;
  }
  throw new Error('امکان ساخت مبلغ یکتای پرداخت نیست؛ سفارش جدیدی نسازید و با پشتیبانی تماس بگیرید.');
}

async function autoCardPayStart(env, chatId, u, kind, a, b) {
  const cfg = await getCfg(env);
  if (cfg.card_auto_enabled !== true) {
    await msg(env, chatId, '❌ کارت‌به‌کارت خودکار توسط ادمین غیرفعال است.', KB([[BTN('◀️ برگشت', 'home')]]));
    return;
  }
  if (!env.SHETAB_API_SECRET) {
    await msg(env, chatId, '❌ پرداخت خودکار پیکربندی نشده است؛ Secret اتصال Shetab را بررسی کنید.', KB([[BTN('◀️ برگشت', 'home')]]));
    return;
  }
  if (!cfg.card_number) {
    await msg(env, chatId, '❌ شماره کارت هنوز توسط ادمین تنظیم نشده است.', KB([[BTN('◀️ برگشت', 'home')]]));
    return;
  }
  const plans = await getPlans(env);
  const panels = await getPanels(env);
  const plan = plans[b];
  if (!plan || plan.enabled === false) {
    await msg(env, chatId, '❌ این پلن دیگر فعال نیست.', KB([[BTN('◀️ برگشت', 'home')]]));
    return;
  }
  let panelId = a;
  let subSid = null;
  if (kind === 'buy') {
    const panel = panels[a];
    if (!panel || panel.enabled === false) {
      await msg(env, chatId, '❌ این سرور دیگر فعال نیست.', KB([[BTN('◀️ برگشت', 'home')]]));
      return;
    }
  } else if (kind === 'renew') {
    const sub = await getSub(env, a);
    if (!sub || String(sub.tg_id) !== String(u.tg_id)) {
      await msg(env, chatId, '❌ اشتراک پیدا نشد یا متعلق به شما نیست.', KB([[BTN('◀️ اشتراک‌های من', 'mysubs')]]));
      return;
    }
    panelId = sub.panel_id;
    subSid = a;
    if (!panels[panelId] || panels[panelId].enabled === false) {
      await msg(env, chatId, '❌ سرور این اشتراک در حال حاضر فعال نیست.', KB([[BTN('◀️ اشتراک‌های من', 'mysubs')]]));
      return;
    }
  } else {
    await msg(env, chatId, '❌ نوع سفارش نامعتبر است.');
    return;
  }
  const baseAmount = Number(plan.price);
  if (!Number.isSafeInteger(baseAmount) || baseAmount <= 0) {
    await msg(env, chatId, '❌ مبلغ پلن معتبر نیست؛ لطفاً با پشتیبانی تماس بگیرید.');
    return;
  }

  let order = null;
  const pending = await kvGet(env, 'pend', []);
  for (const id of pending) {
    const candidate = await getOrder(env, id);
    if (!candidate || candidate.status !== 'pending' || candidate.payment_method !== 'shetab') continue;
    const sameTarget = kind === 'buy'
      ? candidate.type === 'buy' && candidate.panel_id === panelId && candidate.plan_id === b
      : candidate.type === 'renew' && candidate.sub_sid === subSid && candidate.plan_id === b;
    if (String(candidate.tg_id) === String(u.tg_id) && sameTarget) { order = candidate; break; }
  }
  if (order && order.payment_status === 'paid') {
    await msg(env, chatId,
      '✅ پرداخت این سفارش قبلاً شناسایی شده است.\n\n🧾 شماره سفارش: <code>' + order.id + '</code>\n⏳ تحویل در حال پیگیری است؛ لطفاً پرداخت دیگری انجام ندهید.',
      KB([[BTN('📞 پشتیبانی', 'sup')], [BTN('🏠 منوی اصلی', 'home')]]));
    return;
  }
  if (!order) {
    const orderId = uid(6);
    const payAmount = await reserveShetabAmount(env, baseAmount, orderId);
    order = await newOrder(env, {
      id: orderId, tg_id: u.tg_id, username: u.username, first_name: u.first_name,
      type: kind, panel_id: panelId, plan_id: b, sub_sid: subSid,
      amount: baseAmount, pay_amount: payAmount,
      payment_method: 'shetab', payment_status: 'waiting'
    });
  }

  const rialPayAmount = rialFromToman(order.pay_amount);
  const desc = (kind === 'renew' ? 'تمدید اشتراک' : 'خرید اشتراک') + ' «' + plan.title + '»';
  const text = '⚡ <b>پرداخت خودکار کارت‌به‌کارت</b>\n\n' +
    '🧾 سفارش: <code>' + order.id + '</code>\n' +
    '📋 بابت: ' + esc(desc) + '\n' +
    '💵 قیمت پلن: ' + fmtToman(order.amount) + '\n' +
    '✅ <b>مبلغ یکتای سفارش (تومان): ' + fmtToman(order.pay_amount) + '</b>' +
    '\n🏦 <b>برای فیلد ریالی بانک: ' + fmtRialFromToman(order.pay_amount) + '</b>' +
    '\n<i>اگر اپ بانکی مبلغ را به تومان می‌خواهد، مبلغ تومان را وارد کنید؛ اگر ریال می‌خواهد، دکمهٔ کپی ریال را بزنید.</i>\n\n' +
    '💳 شماره کارت:\n<code>' + esc(String(cfg.card_number).replace(/\s/g, '')) + '</code>' +
    (cfg.card_holder ? '\n👤 به‌نام: ' + esc(cfg.card_holder) : '') +
    '\n\nلطفاً دقیقاً همین مبلغ را واریز کنید. بعد از رسیدن پیامک بانک به گوشی، اپ تأیید آن را به ربات می‌فرستد و سفارش خودکار تحویل می‌شود.' +
    '\nاگر تأیید خودکار انجام نشد، رسید و شماره سفارش را برای پشتیبانی بفرستید؛ ادمین می‌تواند همین سفارش را دستی بررسی کند. لطفاً سفارش دوم نسازید.';
  await msg(env, chatId, text, KB([
    [COPYBTN('📋 کپی مبلغ ریالی', rialPayAmount)],
    [BTN('📞 پشتیبانی', 'sup')],
    [BTN('❌ بستن', 'home')]
  ]));
}

// ثبت سفارش کارت‌به‌کارت بعد از دریافت رسید
async function submitReceiptOrder(env, u, data, receipt) {
  const plans = await getPlans(env);
  const panels = await getPanels(env);
  let o;
  if (data.amount) {
    o = await newOrder(env, { tg_id: u.tg_id, username: u.username, first_name: u.first_name, type: 'charge', amount: Number(data.amount), payment_method: 'manual', receipt_file_id: receipt.file_id || null, receipt_text: receipt.text || null });
  } else if (data.kind === 'buy') {
    const plan = plans[data.b];
    const panel = panels[data.a];
    if (!plan || !panel) throw new Error('plan/panel');
    o = await newOrder(env, { tg_id: u.tg_id, username: u.username, first_name: u.first_name, type: 'buy', panel_id: data.a, plan_id: data.b, amount: plan.price, payment_method: 'manual', receipt_file_id: receipt.file_id || null, receipt_text: receipt.text || null });
  } else {
    const plan = plans[data.b];
    const sub = await getSub(env, data.a);
    if (!plan || !sub) throw new Error('plan/sub');
    o = await newOrder(env, { tg_id: u.tg_id, username: u.username, first_name: u.first_name, type: 'renew', panel_id: sub.panel_id, plan_id: data.b, sub_sid: data.a, amount: plan.price, payment_method: 'manual', receipt_file_id: receipt.file_id || null, receipt_text: receipt.text || null });
  }
  await clearState(env, u.tg_id);
  await msg(env, u.tg_id,
    '✅ <b>رسید شما دریافت شد!</b>\n\n🧾 شماره سفارش: <code>' + o.id + '</code>\n💵 مبلغ: ' + fmtToman(o.amount) +
    '\n\n⏳ سفارش در انتظار تأیید ادمین است. نتیجه اینجا اعلام می‌شود.',
    KB([[BTN('🏠 منوی اصلی', 'home')]]));
  return o;
}

async function adminNotifyOrder(env, o) {
  const plans = await getPlans(env);
  const panels = await getPanels(env);
  const plan = plans[o.plan_id];
  const panel = panels[o.panel_id];
  const buyer = '<a href="tg://user?id=' + o.tg_id + '">' + esc(o.first_name || o.username || o.tg_id) + '</a> (<code>' + o.tg_id + '</code>)';
  let t = '🧾 <b>سفارش جدید #' + o.id + '</b>\n' +
    '👤 خریدار: ' + buyer +
    '\n📋 نوع: ' + orderTypeFa(o.type) +
    (plan ? '\n📦 پلن: ' + esc(plan.title) : '') +
    (panel ? '\n🖥 سرور: ' + esc(panel.name) : '') +
    '\n💵 مبلغ پلن: <b>' + fmtToman(o.amount) + '</b>' +
    (o.pay_amount != null ? '\n🏦 مبلغ دقیق انتقال: <b>' + fmtToman(o.pay_amount) + '</b>' : '');
  if (o.receipt_text) t += '\n🧾 رسید/کد پیگیری: ' + esc(o.receipt_text).slice(0, 300);
  const kb = KB([[BTN('✅ تأیید', 'a_ok:' + o.id), BTN('❌ رد', 'a_no:' + o.id)], [BTN('🔍 جزئیات', 'a_ord:' + o.id)]]);
  for (const id of adminIds(env)) {
    try {
      if (o.receipt_file_id) await sendPhoto(env, id, o.receipt_file_id, t, kb);
      else await msg(env, id, t, kb);
    } catch (e) {}
  }
}

/* ---------- تحویل اشتراک ---------- */

async function deliveryText(env, panel, plan, huser, isRenew) {
  const rem = planRemaining(huser);
  const link = userLink(panel, huser.uuid);
  let t = (isRenew ? '🔄 <b>اشتراک تیزنت VPN شما تمدید شد!</b> 🎉' : '✅ <b>اشتراک تیزنت VPN شما فعال شد!</b> 🎉') +
    '\n\n🖥 سرور: <b>' + esc(panel.name) + '</b>' +
    '\n📦 پلن: <b>' + esc(plan.title) + '</b>' +
    '\n📊 حجم: <b>' + (Number(plan.gb) === 0 ? '♾ نامحدود' : fmtGB(huser.usage_limit_GB != null ? huser.usage_limit_GB : plan.gb)) + '</b>' +
    '\n⏳ مدت: <b>' + faNum(plan.days) + ' روز</b>';
  if (rem.expiry) t += '\n📅 انقضا: <b>' + jstr(rem.expiry) + '</b>';
  t += '\n\n🔗 <b>لینک اشتراک (کپی کنید):</b>\n<code>' + esc(link) + '</code>' +
    '\n\n👆 این لینک را در اپ Hiddify وارد کنید (افزودن از لینک).' +
    '\n💡 از «اشتراک‌های من» همیشه به لینک و مصرف دسترسی دارید.';
  return t;
}

function referralInviteState(user) {
  const joined = Math.max(0, Math.floor(Number(user && user.referral_join_count || 0)));
  const claimed = Math.max(0, Math.floor(Number(user && user.referral_free_rewards_claimed || 0)));
  const earned = Math.floor(joined / 3);
  return { joined: joined, claimed: claimed, earned: earned, available: Math.max(0, earned - claimed), progress: joined % 3 };
}

async function awardReferralPoints(env, referrerId, points, type, eventId, details) {
  const ownerId = String(referrerId || '');
  const amount = Math.floor(Number(points));
  const eventType = String(type || '');
  const safeEventId = String(eventId || '').replace(/[^A-Za-z0-9:_-]/g, '').slice(0, 120);
  if (!/^\d{1,20}$/.test(ownerId) || !Number.isInteger(amount) || amount < 1 || !['join', 'purchase'].includes(eventType) || !safeEventId) return { awarded: false, reason: 'invalid_event' };
  const eventKey = 'referral_points_event:' + eventType + ':' + safeEventId;
  if (await kvGet(env, eventKey, null)) return { awarded: false, duplicate: true };
  const lockKey = 'referral_balance_lock:' + ownerId;
  const existingLock = await kvGet(env, lockKey, null);
  if (existingLock && Date.now() - Number(existingLock.started_at || 0) < 30000) return { awarded: false, busy: true };
  await kvPut(env, lockKey, { started_at: Date.now(), event_id: safeEventId }, 60);
  try {
    if (await kvGet(env, eventKey, null)) return { awarded: false, duplicate: true };
    const ref = await getUser(env, ownerId);
    if (!ref || ref.banned) return { awarded: false, reason: 'referrer_unavailable' };
    const currentPoints = Math.max(0, Math.floor(Number(ref.referral_points_balance || 0)));
    ref.referral_points_balance = currentPoints + amount;
    ref.referral_points_earned_total = Math.max(0, Math.floor(Number(ref.referral_points_earned_total || 0))) + amount;
    if (eventType === 'join') {
      ref.referral_join_count = Math.max(0, Math.floor(Number(ref.referral_join_count || 0))) + 1;
      ref.invited = Math.max(0, Math.floor(Number(ref.invited || 0))) + 1;
    } else {
      ref.referral_purchase_count = Math.max(0, Math.floor(Number(ref.referral_purchase_count || 0))) + 1;
    }
    await saveUser(env, ref);
    await kvPut(env, eventKey, Object.assign({
      type: eventType, referrer_id: ownerId, points: amount, event_id: safeEventId, created_at: Date.now()
    }, details && typeof details === 'object' ? details : {}));
    return { awarded: true, points: amount, points_balance: ref.referral_points_balance, joined_count: Number(ref.referral_join_count || 0), purchase_count: Number(ref.referral_purchase_count || 0) };
  } finally { await kvDel(env, lockKey); }
}

async function ensureReferralJoinAward(env, referredUser) {
  if (!referredUser || !referredUser.referred_by) return { awarded: false, reason: 'no_referrer' };
  if (referredUser.referral_join_eligible !== true) return { awarded: false, reason: 'not_eligible' };
  if (referredUser.referral_join_rewarded === true) return { awarded: false, duplicate: true };
  const referredId = String(referredUser.tg_id || '');
  const referrerId = String(referredUser.referred_by || '');
  if (!/^\d{1,20}$/.test(referredId) || !/^\d{1,20}$/.test(referrerId) || referredId === referrerId) return { awarded: false, reason: 'invalid_referral' };
  const result = await awardReferralPoints(env, referrerId, 5, 'join', referredId, { referred_user_id: referredId });
  if (result.awarded || result.duplicate) {
    referredUser.referral_join_rewarded = true;
    try { await saveUser(env, referredUser); } catch (e) {}
  }
  return result;
}

async function attachNewReferral(env, user, code) {
  if (!user || !user._isNew || user.referred_by) return false;
  const value = String(code || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  if (!value) return false;
  const refId = await kvGet(env, 'ref:' + value, null);
  if (!refId || String(refId) === String(user.tg_id)) return false;
  const ref = await getUser(env, refId);
  if (!ref) return false;
  user.referred_by = Number(refId);
  user.referral_join_eligible = true;
  await saveUser(env, user);
  const result = await ensureReferralJoinAward(env, user);
  if (result.awarded) {
    let refUser = await getUser(env, refId) || ref;
    let state = referralInviteState(refUser);
    let rewardsIssued = 0;
    for (let i = 0; i < Math.min(state.available, 10); i++) {
      const reward = await issueReferralFreeSubscription(env, refUser, 'auto');
      if (!reward.ok) break;
      rewardsIssued++;
      refUser = await getUser(env, refId) || refUser;
      state = referralInviteState(refUser);
    }
    const rewardNote = rewardsIssued
      ? '\\n🎁 هدیهٔ خودکار شما: ' + faNum(rewardsIssued) + ' اشتراک ۳ گیگ / ۳ روز صادر شد.'
      : (state.available ? '\\n🎁 یک هدیهٔ دعوت برای دریافت دارید؛ آن را از زبانهٔ عضوگیری اپ دریافت کنید.' : '');
    try {
      await msg(env, refId, '👥 یک عضو جدید با لینک اختصاصی شما وارد ربات شد.\\n⭐ ۵ امتیاز به حساب شما اضافه شد.\\n🎁 پیشرفت هدیهٔ بعدی: ' + faNum(state.progress || (state.available ? 3 : 0)) + ' از ۳ نفر' + rewardNote);
    } catch (e) {}
  }
  return true;
}

async function awardReferralCommission(env, referrerId, amount, eventId, buyerId) {
  const ownerId = String(referrerId || '');
  const safeEventId = String(eventId || '').replace(/[^A-Za-z0-9:_-]/g, '').slice(0, 120);
  const credit = Math.floor(Number(amount || 0));
  if (!/^\d{1,20}$/.test(ownerId) || !Number.isSafeInteger(credit) || credit < 1 || !safeEventId) return { credited: 0 };
  const eventKey = 'referral_commission_event:' + safeEventId;
  if (await kvGet(env, eventKey, null)) return { credited: 0, duplicate: true };
  const lockKey = 'referral_balance_lock:' + ownerId;
  const existingLock = await kvGet(env, lockKey, null);
  if (existingLock && Date.now() - Number(existingLock.started_at || 0) < 30000) return { credited: 0, busy: true };
  await kvPut(env, lockKey, { started_at: Date.now(), event_id: safeEventId }, 60);
  try {
    if (await kvGet(env, eventKey, null)) return { credited: 0, duplicate: true };
    const ref = await getUser(env, ownerId);
    if (!ref || ref.banned) return { credited: 0, reason: 'referrer_unavailable' };
    ref.balance = Number(ref.balance || 0) + credit;
    ref.earned = Number(ref.earned || 0) + credit;
    await saveUser(env, ref);
    await kvPut(env, eventKey, { referrer_id: ownerId, referred_user_id: String(buyerId || ''), amount: credit, event_id: safeEventId, created_at: Date.now() });
    return { credited: credit, balance: ref.balance };
  } finally { await kvDel(env, lockKey); }
}

async function applyCommission(env, cfg, buyer, amount, eventId) {
  if (!buyer || !buyer.referred_by) return 0;
  const referrerId = String(buyer.referred_by);
  const ref = await getUser(env, referrerId);
  if (!ref || ref.banned) return 0;
  const eventKey = String(eventId || '');
  const pct = Math.max(0, Number(cfg && cfg.commission) || 0);
  const commissionAmount = pct > 0 ? Math.max(0, Math.floor(Number(amount || 0) * pct / 100)) : 0;
  if (!buyer.first_paid) { buyer.first_paid = true; await saveUser(env, buyer); }
  await ensureReferralJoinAward(env, buyer);
  const points = eventKey ? await awardReferralPoints(env, referrerId, 10, 'purchase', eventKey, {
    referred_user_id: String(buyer.tg_id || ''), order_id: eventKey
  }) : { awarded: false };
  const commission = eventKey && commissionAmount > 0
    ? await awardReferralCommission(env, referrerId, commissionAmount, eventKey, buyer.tg_id)
    : { credited: 0 };
  const latestRef = commission.credited ? await getUser(env, referrerId) : ref;
  if (commission.credited > 0 || points.awarded) {
    try {
      const parts = [];
      if (commission.credited > 0 && latestRef) parts.push('💰 پورسانت ' + fmtToman(commission.credited) + ' به کیف پول شما افزوده شد. موجودی: ' + fmtToman(latestRef.balance));
      if (points.awarded) parts.push('⭐ ۱۰ امتیاز بابت خرید موفق زیرمجموعه به حساب شما اضافه شد. امتیاز قابل‌تبدیل: ' + faNum(points.points_balance));
      await msg(env, referrerId, '🎁 <b>پاداش زیرمجموعهٔ شما</b>\n\n' + parts.join('\n'));
    } catch (e) {}
  }
  return Number(commission.credited || 0);
}

// تأیید سفارش (توسط ادمین) — ساخت/تمدید واقعی در پنل
async function approveOrder(env, o, options) {
  const cfg = await getCfg(env);
  const opts = options || {};
  if (!o || o.status === 'approved') return;
  if (o.payment_method !== 'wallet' && o.payment_status !== 'paid') {
    o.payment_status = 'paid';
    o.payment_received_at = o.payment_received_at || Date.now();
  }
  if (o.type === 'charge') {
    const u = await getUser(env, o.tg_id);
    if (!u) throw new Error('کاربر پیدا نشد');
    u.balance = (u.balance || 0) + o.amount;
    await saveUser(env, u);
    o.status = 'approved';
    await saveOrder(env, o);
    await recordCustomerActivity(env, o.tg_id, 'order_approved', { order_id: o.id, kind: o.type, amount: o.amount });
    await recordLedgerSafely(env, {
      id: o.id, kind: 'wallet_topup', tg_id: String(o.tg_id), amount: o.amount,
      payment_method: o.payment_method || 'manual', manual_approval: !!o.manual_approval, manual_approved_by: String(o.manual_approved_by || ''), occurred_at: o.updated_at || Date.now()
    });
    if (!opts.suppressCustomer) {
      try { await msg(env, o.tg_id, '✅ <b>شارژ کیف پول تأیید شد!</b>\n\n💰 مبلغ: ' + fmtToman(o.amount) + '\n💰 موجودی فعلی: <b>' + fmtToman(u.balance) + '</b>', KB([[BTN('🛍 خرید اشتراک', 'buy')], [BTN('🏠 منوی اصلی', 'home')]])); }
      catch (e) { try { await notifyAdmins(env, '⚠️ شارژ سفارش <code>' + esc(o.id) + '</code> ثبت شد، اما پیام تأیید به مشتری نرسید.'); } catch (e2) {} }
    }
    return;
  }
  const panels = await getPanels(env);
  const plans = await getPlans(env);
  const panel = panels[o.panel_id];
  const plan = plans[o.plan_id];
  if (!panel || panel.enabled === false) throw new Error('پنل این سفارش غیرفعال است');
  if (!plan) throw new Error('پلن این سفارش حذف شده');
  if (o.type === 'buy') {
    const created = await hCreateUser(panel, {
      name: subName(o.tg_id), gb: plan.gb, days: plan.days,
      telegram_id: Number(o.tg_id), comment: 'shop order ' + o.id + ' | ' + plan.title
    });
    const sid = uid(6);
    await saveSub(env, { sid: sid, uuid: created.uuid, panel_id: o.panel_id, plan_id: o.plan_id, tg_id: o.tg_id, order_id: o.id, created_at: Date.now(), reminded: '', expire_noticed: false });
    const u = await getUser(env, o.tg_id);
    u.subs = u.subs || [];
    u.subs.push(sid);
    u.total_spent = (u.total_spent || 0) + o.amount;
    await saveUser(env, u);
    o.status = 'approved';
    o.sub_sid = sid;
    await saveOrder(env, o);
    await recordCustomerActivity(env, o.tg_id, 'order_approved', { order_id: o.id, kind: o.type, amount: o.amount });
    cfg.total_revenue = (cfg.total_revenue || 0) + o.amount;
    cfg.total_sales = (cfg.total_sales || 0) + 1;
    await saveCfg(env, cfg);
    await recordLedgerSafely(env, {
      id: o.id, kind: 'sale', type: 'buy', order_id: o.id, tg_id: String(o.tg_id),
      amount: o.amount, payment_method: o.payment_method || ((o.receipt_file_id || o.receipt_text) ? 'manual' : 'unknown'),
      panel_id: o.panel_id, plan_id: o.plan_id, sub_sid: sid, manual_approval: !!o.manual_approval, manual_approved_by: String(o.manual_approved_by || ''),
      occurred_at: o.payment_received_at || o.updated_at || Date.now()
    });
    await applyCommission(env, cfg, u, o.amount, o.id);
    const t = await deliveryText(env, panel, plan, created, false);
    if (!opts.suppressCustomer) {
      try { await deliverSubscriptionWithQr(env, o.tg_id, t, userLink(panel, created.uuid), KB([[BTN('📖 راهنما', 'help'), BTN('📥 دانلود اپ‌ها', 'apps')], [BTN('📦 اشتراک‌های من', 'mysubs')]])); }
      catch (e) { try { await notifyAdmins(env, '⚠️ سفارش <code>' + esc(o.id) + '</code> تأیید و سرویس ساخته شد، اما پیام تحویل به مشتری نرسید.'); } catch (e2) {} }
    }
    return;
  }
  if (o.type === 'renew') {
    const sub = await getSub(env, o.sub_sid);
    if (!sub) throw new Error('اشتراک پیدا نشد');
    const patched = await hPatchUser(panel, sub.uuid, { gb: plan.gb, days: plan.days });
    sub.plan_id = o.plan_id;
    sub.expire_noticed = false;
    sub.reminded = '';
    await saveSub(env, sub);
    const u = await getUser(env, o.tg_id);
    u.total_spent = (u.total_spent || 0) + o.amount;
    await saveUser(env, u);
    o.status = 'approved';
    await saveOrder(env, o);
    await recordCustomerActivity(env, o.tg_id, 'order_approved', { order_id: o.id, kind: o.type, amount: o.amount });
    cfg.total_revenue = (cfg.total_revenue || 0) + o.amount;
    cfg.total_sales = (cfg.total_sales || 0) + 1;
    await saveCfg(env, cfg);
    await recordLedgerSafely(env, {
      id: o.id, kind: 'sale', type: 'renew', order_id: o.id, tg_id: String(o.tg_id),
      amount: o.amount, payment_method: o.payment_method || ((o.receipt_file_id || o.receipt_text) ? 'manual' : 'unknown'),
      panel_id: o.panel_id, plan_id: o.plan_id, sub_sid: o.sub_sid,
      upgrade_from_plan_id: o.upgrade_from_plan_id || '', manual_approval: !!o.manual_approval, manual_approved_by: String(o.manual_approved_by || ''),
      occurred_at: o.payment_received_at || o.updated_at || Date.now()
    });
    await applyCommission(env, cfg, u, o.amount, o.id);
    const t = await deliveryText(env, panel, plan, patched, true);
    if (!opts.suppressCustomer) {
      try { await deliverSubscriptionWithQr(env, o.tg_id, t, userLink(panel, sub.uuid), KB([[BTN('📦 اشتراک‌های من', 'mysubs')], [BTN('🏠 منوی اصلی', 'home')]])); }
      catch (e) { try { await notifyAdmins(env, '⚠️ تمدید سفارش <code>' + esc(o.id) + '</code> انجام شد، اما پیام تحویل به مشتری نرسید.'); } catch (e2) {} }
    }
    return;
  }
  throw new Error('نوع سفارش نامعتبر');
}

// خرید فوری با کیف پول
async function walletBuy(env, u, pid, plid, messageId) {
  const panels = await getPanels(env);
  const plans = await getPlans(env);
  const cfg = await getCfg(env);
  const panel = panels[pid];
  const plan = plans[plid];
  if (!panel || panel.enabled === false || !plan || plan.enabled === false) {
    await msg(env, u.tg_id, '❌ این پلن یا سرور دیگر فعال نیست.', KB([[BTN('◀️ برگشت', 'home')]]));
    return;
  }
  if ((u.balance || 0) < plan.price) {
    await msg(env, u.tg_id, '❌ موجودی کافی نیست.\n💰 موجودی: ' + fmtToman(u.balance) + '\n💵 مبلغ پلن: ' + fmtToman(plan.price), KB([[BTN('💰 شارژ کیف پول', 'wallet')], [BTN('◀️ برگشت', 'home')]]));
    return;
  }
  await editMsg(env, u.tg_id, messageId, '⏳ در حال ساخت اشتراک در سرور <b>' + esc(panel.name) + '</b>...\nلطفاً کمی صبر کنید.');
  u.balance -= plan.price;
  await saveUser(env, u);
  try {
    const created = await hCreateUser(panel, {
      name: subName(u.tg_id), gb: plan.gb, days: plan.days,
      telegram_id: Number(u.tg_id), comment: 'shop wallet | ' + plan.title
    });
    const sid = uid(6);
    await saveSub(env, { sid: sid, uuid: created.uuid, panel_id: pid, plan_id: plid, tg_id: u.tg_id, order_id: null, created_at: Date.now(), reminded: '', expire_noticed: false });
    u.subs = u.subs || [];
    u.subs.push(sid);
    u.total_spent = (u.total_spent || 0) + plan.price;
    await saveUser(env, u);
    cfg.total_revenue = (cfg.total_revenue || 0) + plan.price;
    cfg.total_sales = (cfg.total_sales || 0) + 1;
    await saveCfg(env, cfg);
    const saleId = 'wallet-buy-' + sid;
    await recordLedgerSafely(env, {
      id: saleId, kind: 'sale', type: 'buy', order_id: null,
      tg_id: String(u.tg_id), username: u.username || '', amount: plan.price,
      payment_method: 'wallet', panel_id: pid, plan_id: plid, sub_sid: sid,
      occurred_at: Date.now()
    });
    await applyCommission(env, cfg, u, plan.price, saleId);
    const t = await deliveryText(env, panel, plan, created, false);
    await deliverSubscriptionWithQr(env, u.tg_id, t, userLink(panel, created.uuid), KB([[BTN('📖 راهنما', 'help'), BTN('📥 دانلود اپ‌ها', 'apps')], [BTN('📦 اشتراک‌های من', 'mysubs')]]));
    try { await notifyAdmins(env, '⚡ <b>خرید فوری با کیف پول</b>\n👤 <code>' + u.tg_id + '</code>\n📦 ' + esc(plan.title) + '\n🖥 ' + esc(panel.name) + '\n💵 ' + fmtToman(plan.price)); } catch (e) {}
  } catch (e) {
    u.balance += plan.price; // برگشت وجه در صورت خطا
    await saveUser(env, u);
    await msg(env, u.tg_id, '❌ <b>خطا در ساخت اشتراک!</b>\nمبلغ به کیف پول شما برگشت خورد.\n\nعلت: <code>' + esc(String(e.message).slice(0, 300)) + '</code>\nلطفاً به پشتیبانی اطلاع دهید.', KB([[BTN('◀️ برگشت', 'home')]]));
    try { await notifyAdmins(env, '🚨 <b>خطای ساخت یوزر در پنل</b>\n🖥 ' + esc(panel.name) + '\n👤 <code>' + u.tg_id + '</code>\n<code>' + esc(String(e.message).slice(0, 500)) + '</code>'); } catch (e2) {}
  }
}

// تمدید فوری با کیف پول
async function walletRenew(env, u, sid, plid, messageId) {
  const panels = await getPanels(env);
  const plans = await getPlans(env);
  const cfg = await getCfg(env);
  const sub = await getSub(env, sid);
  const plan = plans[plid];
  if (!sub || !plan) { await msg(env, u.tg_id, '❌ اشتراک یا پلن پیدا نشد.'); return; }
  const panel = panels[sub.panel_id];
  if (!panel || panel.enabled === false) { await msg(env, u.tg_id, '❌ سرور این اشتراک غیرفعال است.'); return; }
  if ((u.balance || 0) < plan.price) {
    await msg(env, u.tg_id, '❌ موجودی کافی نیست.', KB([[BTN('💰 شارژ کیف پول', 'wallet')]]));
    return;
  }
  await editMsg(env, u.tg_id, messageId, '⏳ در حال تمدید اشتراک...');
  u.balance -= plan.price;
  await saveUser(env, u);
  try {
    const patched = await hPatchUser(panel, sub.uuid, { gb: plan.gb, days: plan.days });
    sub.plan_id = plid;
    sub.expire_noticed = false;
    sub.reminded = '';
    await saveSub(env, sub);
    u.total_spent = (u.total_spent || 0) + plan.price;
    await saveUser(env, u);
    cfg.total_revenue = (cfg.total_revenue || 0) + plan.price;
    cfg.total_sales = (cfg.total_sales || 0) + 1;
    await saveCfg(env, cfg);
    const saleId = 'wallet-renew-' + uid(8);
    await recordLedgerSafely(env, {
      id: saleId, kind: 'sale', type: 'renew', order_id: null,
      tg_id: String(u.tg_id), username: u.username || '', amount: plan.price,
      payment_method: 'wallet', panel_id: sub.panel_id, plan_id: plid, sub_sid: sid,
      occurred_at: Date.now()
    });
    await applyCommission(env, cfg, u, plan.price, saleId);
    const t = await deliveryText(env, panel, plan, patched, true);
    await deliverSubscriptionWithQr(env, u.tg_id, t, userLink(panel, sub.uuid), KB([[BTN('📦 اشتراک‌های من', 'mysubs')]]));
  } catch (e) {
    u.balance += plan.price;
    await saveUser(env, u);
    await msg(env, u.tg_id, '❌ <b>خطا در تمدید!</b> مبلغ برگشت خورد.\n<code>' + esc(String(e.message).slice(0, 300)) + '</code>', KB([[BTN('◀️ برگشت', 'home')]]));
  }
}

/* ============================ اشتراک‌های من ============================ */

async function showMySubs(env, chatId, messageId, u) {
  const subs = [];
  for (const sid of (u.subs || [])) {
    const s = await getSub(env, sid);
    if (s) subs.push(s);
  }
  if (!subs.length) {
    const t = '📦 شما هنوز اشتراکی ندارید.\nاز دکمه زیر اولین اشتراک را بخرید 👇';
    const kb = KB([[BTN('🛍 خرید اشتراک', 'buy')], [BTN('◀️ برگشت', 'home')]]);
    if (messageId) await editMsg(env, chatId, messageId, t, kb);
    else await msg(env, chatId, t, kb);
    return;
  }
  const panels = await getPanels(env);
  const plans = await getPlans(env);
  const rows = subs.map((s) => {
    const pn = panels[s.panel_id] ? panels[s.panel_id].name : '?';
    const pl = plans[s.plan_id] ? plans[s.plan_id].title : '';
    return [BTN('📦 ' + pn + ' | ' + pl, 'sub:' + s.sid)];
  });
  rows.push([BTN('◀️ برگشت', 'home')]);
  const t = '📦 <b>اشتراک‌های شما:</b>\nبرای مشاهده جزئیات، مصرف و لینک، یکی را انتخاب کنید.';
  if (messageId) await editMsg(env, chatId, messageId, t, KB(rows));
  else await msg(env, chatId, t, KB(rows));
}

async function showSubDetail(env, chatId, messageId, u, sid) {
  const sub = await getSub(env, sid);
  if (!sub || sub.tg_id !== u.tg_id) {
    await msg(env, chatId, '❌ اشتراک پیدا نشد.', KB([[BTN('◀️ برگشت', 'mysubs')]]));
    return;
  }
  const panels = await getPanels(env);
  const plans = await getPlans(env);
  const panel = panels[sub.panel_id];
  const plan = plans[sub.plan_id];
  if (!panel) { await msg(env, chatId, '❌ سرور این اشتراک حذف شده. با پشتیبانی در تماس باشید.'); return; }
  let live = null, liveErr = '';
  try { live = await hGetLive(panel, sub.uuid); }
  catch (e) { liveErr = String(e.message).slice(0, 200); }
  const gbTotal = live && live.usage_limit_GB != null ? Number(live.usage_limit_GB) : Number(plan ? plan.gb : 0);
  const gbUsed = live && live.current_usage_GB != null ? Number(live.current_usage_GB) : 0;
  const gbLeft = gbTotal >= 100000 || gbTotal === 0 ? '♾ نامحدود' : fmtGB(Math.max(0, gbTotal - gbUsed));
  const rem = live ? planRemaining(live) : { days: null, expiry: null };
  const active = live ? (live.is_active !== false && live.enable !== false) : null;
  let t = '📦 <b>جزئیات اشتراک</b>\n\n' +
    '🖥 سرور: <b>' + esc(panel.name) + '</b>' +
    '\n📦 پلن: <b>' + esc(plan ? plan.title : '—') + '</b>' +
    '\n📶 وضعیت: <b>' + (active == null ? 'نامشخص' : active ? '✅ فعال' : '⛔ غیرفعال/منقضی') + '</b>' +
    '\n\n📊 مصرف: <b>' + fmtGB(gbUsed) + '</b> از <b>' + (gbTotal >= 100000 || gbTotal === 0 ? '♾ نامحدود' : fmtGB(gbTotal)) + '</b>' +
    '\n📉 باقی‌مانده: <b>' + gbLeft + '</b>';
  if (rem.days != null) t += '\n⏳ روزهای باقی‌مانده: <b>' + faNum(rem.days) + ' روز</b>';
  if (rem.expiry) t += '\n📅 انقضا: <b>' + jstr(rem.expiry) + '</b>';
  if (liveErr) t += '\n\n⚠️ <i>نمایش زنده مصرف ممکن نشد؛ اطلاعات تقریبی است.</i>';
  t += '\n\n🔗 <b>لینک اشتراک:</b>\n<code>' + esc(userLink(panel, sub.uuid)) + '</code>';
  const rows = [
    [BTN('🔄 تمدید', 'rnw:' + sid), BTN('📡 دریافت کانفیگ‌ها', 'cfg:' + sid)],
    [BTN('🗑 حذف اشتراک', 'sdel:' + sid)],
    [BTN('◀️ برگشت', 'mysubs')]
  ];
  if (messageId) await editMsg(env, chatId, messageId, t, KB(rows));
  else await msg(env, chatId, t, KB(rows));
}

/* ============================ کیف پول و شارژ ============================ */

async function showWallet(env, chatId, messageId, u) {
  const t = '💰 <b>کیف پول</b>\n\n💰 موجودی: <b>' + fmtToman(u.balance) + '</b>' +
    '\n\nبا موجودی کیف پول می‌توانید <b>فوری و بدون انتظار</b> خرید و تمدید کنید ⚡';
  const rows = [[BTN('➕ شارژ کیف پول', 'chg')], [BTN('◀️ برگشت', 'home')]];
  if (messageId) await editMsg(env, chatId, messageId, t, KB(rows));
  else await msg(env, chatId, t, KB(rows));
}

async function showCharge(env, chatId, messageId) {
  const cfg = await getCfg(env);
  if (cfg.card_manual_enabled === false || !cfg.card_number) {
    const t = '➕ <b>شارژ کیف پول</b>\n\n❌ شارژ از طریق کارت‌به‌کارت دستی در حال حاضر غیرفعال است.';
    const rows = [[BTN('◀️ برگشت', 'wallet')]];
    if (messageId) await editMsg(env, chatId, messageId, t, KB(rows));
    else await msg(env, chatId, t, KB(rows));
    return;
  }
  const t = '➕ <b>شارژ کیف پول</b>\n\nمبلغ را انتخاب کنید یا مبلغ دلخواه (به تومان) بفرستید:';
  const rows = [
    [BTN('۵۰ هزار', 'chg:50000'), BTN('۱۰۰ هزار', 'chg:100000')],
    [BTN('۲۰۰ هزار', 'chg:200000'), BTN('۵۰۰ هزار', 'chg:500000')],
    [BTN('✏️ مبلغ دلخواه', 'chgc')],
    [BTN('◀️ برگشت', 'wallet')]
  ];
  if (messageId) await editMsg(env, chatId, messageId, t, KB(rows));
  else await msg(env, chatId, t, KB(rows));
}

/* ============================ نمایندگی / دعوت ============================ */

async function ensureBotUsername(env, cfg) {
  if (cfg.bot_username) return cfg.bot_username;
  try {
    const me = await tg(env, 'getMe', {});
    if (me && me.username) {
      cfg.bot_username = me.username;
      await saveCfg(env, cfg);
      return me.username;
    }
  } catch (e) {}
  return '';
}

async function showRef(env, chatId, messageId, u) {
  const cfg = await getCfg(env);
  const bun = await ensureBotUsername(env, cfg);
  const link = bun ? 'https://t.me/' + bun + '?start=ref_' + u.ref_code : '—';
  const t = '🎁 <b>دعوت دوستان و کسب درآمد</b>\n\n' +
    '🔗 لینک دعوت شما:\n<code>' + esc(link) + '</code>' +
    '\n\n💰 با هر خرید زیرمجموعه‌ها، <b>' + faNum(cfg.commission) + '٪ مبلغ</b> به کیف پول شما اضافه می‌شود.' +
    '\n👥 تعداد زیرمجموعه‌ها: <b>' + faNum(u.invited || 0) + '</b>' +
    '\n💵 مجموع درآمد شما: <b>' + fmtToman(u.earned || 0) + '</b>' +
    '\n💰 موجودی قابل برداشت/خرید: <b>' + fmtToman(u.balance) + '</b>' +
    '\n\n💸 حداقل مبلغ برداشت: ' + fmtToman(cfg.min_withdraw);
  const rows = [[BTN('💸 درخواست برداشت', 'wd')], [BTN('◀️ برگشت', 'home')]];
  if (messageId) await editMsg(env, chatId, messageId, t, KB(rows));
  else await msg(env, chatId, t, KB(rows));
}

/* ============================ پنل ادمین ============================ */

async function adminHome(env, chatId, messageId) {
  const pend = await kvGet(env, 'pend', []);
  const wpend = await kvGet(env, 'wpend', []);
  const t = '🛠 <b>پنل مدیریت تیزنت VPN</b>\n\n🧾 سفارش‌های باز: <b>' + faNum(pend.length) + '</b>\n💸 برداشت‌های باز: <b>' + faNum(wpend.length) + '</b>';
  const rows = [
    [BTN('📊 آمار', 'a_stats'), BTN('🧾 سفارش‌ها (' + pend.length + ')', 'a_orders')],
    [BTN('🖥 پنل‌ها', 'a_panels'), BTN('📦 پلن‌ها', 'a_plans')],
    [BTN('💳 کارت', 'a_cards'), BTN('👥 کاربران', 'a_users')],
    [BTN('💸 برداشت‌ها (' + wpend.length + ')', 'a_wd'), BTN('📢 پیام همگانی', 'a_bc')],
    [BTN('⚙️ تنظیمات', 'a_set')]
  ];
  const kb = KB(rows);
  if (messageId) await editMsg(env, chatId, messageId, t, kb);
  else await msg(env, chatId, t, kb);
}

async function adminStats(env, chatId, messageId) {
  const cfg = await getCfg(env);
  const users = await kvList(env, 'u:');
  const subs = await kvList(env, 's:');
  const pend = await kvGet(env, 'pend', []);
  const panels = await getPanels(env);
  const plans = await getPlans(env);
  const t = '📊 <b>گزارش سریع فروش تیزنت VPN</b>\n\n' +
    '👥 کاربران: <b>' + faNum(users.length) + '</b>' +
    '\n📦 اشتراک‌های فروخته‌شده: <b>' + faNum(subs.length) + '</b>' +
    '\n🧾 سفارش‌های باز: <b>' + faNum(pend.length) + '</b>' +
    '\n🖥 پنل‌ها: <b>' + faNum(Object.keys(panels).length) + '</b>' +
    '\n📦 پلن‌ها: <b>' + faNum(Object.keys(plans).length) + '</b>' +
    '\n💰 فروش موفق: <b>' + faNum(cfg.total_sales || 0) + '</b>' +
    '\n💵 درآمد کل: <b>' + fmtToman(cfg.total_revenue || 0) + '</b>';
  const kb = KB([[BTN('◀️ پنل مدیریت', 'admin')]]);
  if (messageId) await editMsg(env, chatId, messageId, t, kb);
  else await msg(env, chatId, t, kb);
}

async function adminOrders(env, chatId, messageId) {
  const pend = await kvGet(env, 'pend', []);
  if (!pend.length) {
    const kb = KB([[BTN('◀️ پنل مدیریت', 'admin')]]);
    if (messageId) await editMsg(env, chatId, messageId, '🧾 سفارش بازی وجود ندارد. 🎉', kb);
    else await msg(env, chatId, '🧾 سفارش بازی وجود ندارد. 🎉', kb);
    return;
  }
  const rows = [];
  const rev = pend.slice().reverse().slice(0, 15);
  for (const oid of rev) {
    const o = await getOrder(env, oid);
    if (!o) continue;
    rows.push([BTN('#' + o.id + ' | ' + orderTypeFa(o.type) + ' | ' + Number(o.amount).toLocaleString('en-US'), 'a_ord:' + o.id)]);
  }
  rows.push([BTN('◀️ پنل مدیریت', 'admin')]);
  const t = '🧾 <b>سفارش‌های باز (' + faNum(pend.length) + '):</b>' + (pend.length > 15 ? '\n<i>۱۵ مورد آخر نمایش داده شد.</i>' : '');
  if (messageId) await editMsg(env, chatId, messageId, t, KB(rows));
  else await msg(env, chatId, t, KB(rows));
}

async function adminOrderDetail(env, chatId, messageId, oid) {
  const o = await getOrder(env, oid);
  if (!o) { await msg(env, chatId, '❌ سفارش پیدا نشد.'); return; }
  const plans = await getPlans(env);
  const panels = await getPanels(env);
  const plan = plans[o.plan_id];
  const panel = panels[o.panel_id];
  const buyer = '<a href="tg://user?id=' + o.tg_id + '">' + esc(o.first_name || o.username || o.tg_id) + '</a> (<code>' + o.tg_id + '</code>)';
  let t = '🧾 <b>سفارش #' + o.id + '</b> — ' + (o.status === 'pending' ? '⏳ در انتظار' : esc(o.status)) +
    '\n👤 خریدار: ' + buyer +
    '\n📋 نوع: ' + orderTypeFa(o.type) +
    (plan ? '\n📦 پلن: ' + esc(plan.title) + ' (' + fmtToman(plan.price) + ')' : '') +
    (panel ? '\n🖥 سرور: ' + esc(panel.name) : '') +
    (o.sub_sid ? '\n🔗 اشتراک: <code>' + o.sub_sid + '</code>' : '') +
    '\n💵 مبلغ پلن: <b>' + fmtToman(o.amount) + '</b>' +
    (o.pay_amount != null ? '\n🏦 مبلغ دقیق انتقال: <b>' + fmtToman(o.pay_amount) + '</b>' : '') +
    (o.payment_method === 'shetab' ? '\n⚡ وضعیت پرداخت خودکار: ' + (o.payment_status === 'paid' ? 'تأیید شد' : 'در انتظار پیامک') + (o.payment_ref ? '\n🧾 کد پیگیری: <code>' + esc(o.payment_ref) + '</code>' : '') : '') +
    '\n📅 ثبت: ' + jstr(new Date(o.created_at));
  if (o.receipt_text) t += '\n🧾 رسید: ' + esc(o.receipt_text).slice(0, 400);
  if (o.reject_reason) t += '\n❌ دلیل رد: ' + esc(o.reject_reason);
  const rows = [];
  if (o.status === 'pending') {
    rows.push([BTN('✅ تأیید', 'a_ok:' + o.id), BTN('❌ رد', 'a_no:' + o.id)]);
    if (o.receipt_file_id) rows.push([BTN('🧾 مشاهده رسید', 'a_rcp:' + o.id)]);
    rows.push([BTN('🗃 لغو و بایگانی', 'a_orddel:' + o.id)]);
  }
  rows.push([BTN('◀️ سفارش‌ها', 'a_orders')]);
  if (messageId) await editMsg(env, chatId, messageId, t, KB(rows));
  else await msg(env, chatId, t, KB(rows));
}

async function doApprove(env, adminId, oid, sourceMessage) {
  const o = await getOrder(env, oid);
  if (!o) {
    if (sourceMessage) await updateAdminOrderMessage(env, sourceMessage, '❌ سفارش پیدا نشد.', { reply_markup: { inline_keyboard: [] } });
    else await msg(env, adminId, '❌ سفارش پیدا نشد.');
    return;
  }
  if (o.status !== 'pending') {
    const text = '⚠️ این سفارش قبلاً بررسی شده است؛ وضعیت فعلی: <b>' + esc(o.status) + '</b>.';
    if (sourceMessage) await updateAdminOrderMessage(env, sourceMessage, text, { reply_markup: { inline_keyboard: [] } });
    else await msg(env, adminId, text);
    return;
  }
  const lockKey = 'miniapp_admin_order_lock:' + String(oid);
  const held = await kvGet(env, lockKey, null);
  if (held && Date.now() - Number(held.created_at || 0) < 45000) {
    const text = '⏳ این سفارش همین حالا توسط مدیر دیگری در حال پردازش است. چند لحظه صبر کنید و وضعیت را دوباره بررسی کنید.';
    if (sourceMessage) await updateAdminOrderMessage(env, sourceMessage, text, { reply_markup: { inline_keyboard: [] } });
    else await msg(env, adminId, text);
    return;
  }
  await kvPut(env, lockKey, { admin_id: String(adminId), created_at: Date.now() }, 60);
  try {
    const processing = '⏳ <b>در حال تأیید و پردازش سفارش…</b>\n🧾 شماره: <code>' + esc(oid) + '</code>\nاتصال به پنل برقرار است؛ صفحه را نبندید.';
    if (sourceMessage) await updateAdminOrderMessage(env, sourceMessage, processing, { reply_markup: { inline_keyboard: [] } });
    else await msg(env, adminId, processing);
    try {
      await approveOrder(env, o);
      const latest = await getOrder(env, oid) || o;
      if (latest.status === 'approved') {
        const done = '✅ <b>سفارش تأیید و پردازش شد.</b>\n🧾 شماره: <code>' + esc(oid) + '</code>\nوضعیت تحویل در Mini App قابل مشاهده است.';
        if (sourceMessage) await updateAdminOrderMessage(env, sourceMessage, done, { reply_markup: { inline_keyboard: [] } });
        else await msg(env, adminId, done);
      } else {
        throw new Error('سفارش پس از پردازش همچنان در وضعیت انتظار است.');
      }
    } catch (e) {
      const latest = await getOrder(env, oid) || o;
      if (latest.status === 'approved') {
        const doneWithWarning = '✅ <b>سفارش تأیید و سرویس پردازش شد.</b>\n🧾 شماره: <code>' + esc(oid) + '</code>\n⚠️ یک مرحلهٔ اطلاع‌رسانی جانبی با خطا روبه‌رو شد؛ تأیید/تحویل دوباره نزنید.';
        if (sourceMessage) await updateAdminOrderMessage(env, sourceMessage, doneWithWarning, { reply_markup: { inline_keyboard: [] } });
        else await msg(env, adminId, doneWithWarning);
        try { await notifyAdmins(env, '⚠️ سفارش <code>' + esc(oid) + '</code> تأیید شده است؛ خطای پس از تأیید: <code>' + esc(String(e.message || e).slice(0, 350)) + '</code>'); } catch (e2) {}
        return;
      }
      const errorText = '❌ <b>تأیید انجام نشد؛ سفارش هنوز باز است.</b>\n🧾 شماره: <code>' + esc(oid) + '</code>\nعلت: <code>' + esc(String(e.message || e).slice(0, 500)) + '</code>\nمی‌توانید پس از بررسی، دوباره تلاش کنید.';
      const retryMarkup = KB([[BTN('🔄 تلاش دوباره', 'a_ok:' + oid), BTN('🔍 جزئیات', 'a_ord:' + oid)], [BTN('◀️ سفارش‌ها', 'a_orders')]]);
      if (sourceMessage) await updateAdminOrderMessage(env, sourceMessage, errorText, retryMarkup);
      else await msg(env, adminId, errorText, retryMarkup);
    }
  } finally {
    await kvDel(env, lockKey);
  }
}

async function doReject(env, adminId, oid, reason) {
  const o = await getOrder(env, oid);
  if (!o || o.status !== 'pending') return;
  o.status = 'rejected';
  o.reject_reason = reason || '';
  await saveOrder(env, o);
  await recordCustomerActivity(env, o.tg_id, 'order_rejected', { order_id: o.id, kind: o.type, amount: o.amount, actor_id: adminId });
  await msg(env, adminId, '🚫 سفارش <code>' + oid + '</code> رد شد.');
  try {
    await msg(env, o.tg_id, '❌ <b>سفارش شما رد شد.</b>\n\n🧾 شماره: <code>' + o.id + '</code>' + (reason ? '\n📝 دلیل: ' + esc(reason) : '') + '\n\nاگر فکر می‌کنید اشتباهی شده، به پشتیبانی پیام بدید.', KB([[BTN('🏠 منوی اصلی', 'home')]]));
  } catch (e) {}
}

/* ---------- مدیریت پنل‌ها ---------- */

async function adminPanels(env, chatId, messageId) {
  const panels = await getPanels(env);
  const arr = Object.values(panels);
  let t = '🖥 <b>مدیریت پنل‌ها (سرورها)</b>\n';
  const rows = [];
  if (!arr.length) t += '\n<i>هنوز پنلی اضافه نشده. با دکمه زیر اولین سرور را وصل کنید.</i>';
  for (const p of arr) {
    t += '\n' + (p.enabled === false ? '🔴' : '🟢') + ' <b>' + esc(p.name) + '</b> — <code>' + p.id + '</code>';
    rows.push([BTN((p.enabled === false ? '🔴 ' : '🟢 ') + p.name, 'a_p:' + p.id)]);
  }
  rows.push([BTN('➕ افزودن پنل', 'a_pa_add')]);
  rows.push([BTN('◀️ پنل مدیریت', 'admin')]);
  if (messageId) await editMsg(env, chatId, messageId, t, KB(rows));
  else await msg(env, chatId, t, KB(rows));
}

async function adminPanelDetail(env, chatId, messageId, pid) {
  const panels = await getPanels(env);
  const p = panels[pid];
  if (!p) { await msg(env, chatId, '❌ پنل پیدا نشد.'); return; }
  const t = '🖥 <b>' + esc(p.name) + '</b> ' + (p.enabled === false ? '🔴 غیرفعال' : '🟢 فعال') +
    '\n🆔 کد: <code>' + p.id + '</code>' +
    '\n🔗 API: <code>' + esc(p.api_base) + '</code>' +
    '\n👤 لینک یوزرها: <code>' + esc(p.user_base) + '</code>';
  const rows = [
    [BTN('🔌 تست اتصال', 'a_ptest:' + pid), BTN('📊 وضعیت سرور', 'a_pst:' + pid)],
    [BTN(p.enabled === false ? '✅ فعال‌سازی' : '⛔ غیرفعال‌سازی', 'a_pt:' + pid)],
    [BTN('🗑 حذف پنل', 'a_pdel:' + pid)],
    [BTN('◀️ پنل‌ها', 'a_panels')]
  ];
  if (messageId) await editMsg(env, chatId, messageId, t, KB(rows));
  else await msg(env, chatId, t, KB(rows));
}

/* ---------- مدیریت پلن‌ها ---------- */

async function adminPlans(env, chatId, messageId) {
  const plans = await getPlans(env);
  const arr = Object.values(plans).sort((a, b) => a.price - b.price);
  let t = '📦 <b>مدیریت پلن‌ها</b>\n';
  const rows = [];
  if (!arr.length) t += '\n<i>هنوز پلنی ساخته نشده.</i>';
  for (const p of arr) {
    t += '\n' + (p.enabled === false ? '🔴' : '🟢') + ' ' + planLine(p) + ' — <code>' + p.id + '</code>';
    rows.push([BTN((p.enabled === false ? '🔴 ' : '🟢 ') + p.title + ' | ' + Number(p.price).toLocaleString('en-US'), 'a_pl:' + p.id)]);
  }
  rows.push([BTN('➕ افزودن پلن', 'a_pla_add')]);
  if (!arr.length) rows.push([BTN('✨ ساخت ۳ پلن نمونه', 'a_plsamp')]);
  rows.push([BTN('◀️ پنل مدیریت', 'admin')]);
  const kb = KB(rows);
  // پیام ممکن است طولانی شود
  if (t.length > 3500) t = t.slice(0, 3500) + '\n…';
  if (messageId) await editMsg(env, chatId, messageId, t, kb);
  else await msg(env, chatId, t, kb);
}

async function adminPlanDetail(env, chatId, messageId, plid) {
  const plans = await getPlans(env);
  const p = plans[plid];
  if (!p) { await msg(env, chatId, '❌ پلن پیدا نشد.'); return; }
  const panels = await getPanels(env);
  const assigned = Array.isArray(p.panel_ids) ? p.panel_ids : [];
  const pn = !assigned.length || assigned.includes('all') ? 'همه سرورها' : assigned.map((id) => panels[id] ? panels[id].name : id).join('، ');
  const t = '📦 <b>' + esc(p.title) + '</b> ' + (p.enabled === false ? '🔴' : '🟢') +
    '\n🆔 کد: <code>' + p.id + '</code>' +
    '\n📊 حجم: <b>' + (Number(p.gb) === 0 ? '♾ نامحدود' : fmtGB(p.gb)) + '</b>' +
    '\n⏳ مدت: <b>' + faNum(p.days) + ' روز</b>' +
    '\n💵 قیمت: <b>' + fmtToman(p.price) + '</b>' +
    '\n🖥 سرورها: ' + esc(pn);
  const rows = [
    [BTN(p.enabled === false ? '✅ فعال‌سازی' : '⛔ غیرفعال‌سازی', 'a_plt:' + p.id)],
    [BTN('🗑 حذف پلن', 'a_pldel:' + p.id)],
    [BTN('◀️ پلن‌ها', 'a_plans')]
  ];
  if (messageId) await editMsg(env, chatId, messageId, t, KB(rows));
  else await msg(env, chatId, t, KB(rows));
}

/* ---------- کارت، کاربران، برداشت، همگانی، تنظیمات ---------- */

async function adminCards(env, chatId, messageId) {
  const cfg = await getCfg(env);
  const t = '💳 <b>کارت بانکی فروشگاه</b>\n\n💳 شماره کارت: ' + (cfg.card_number ? '<code>' + esc(cfg.card_number) + '</code>' : '—') +
    '\n👤 به‌نام: ' + (cfg.card_holder ? esc(cfg.card_holder) : '—');
  const rows = [[BTN('✏️ ویرایش شماره کارت', 'a_card_num')], [BTN('✏️ ویرایش نام صاحب کارت', 'a_card_hold')], [BTN('◀️ پنل مدیریت', 'admin')]];
  if (messageId) await editMsg(env, chatId, messageId, t, KB(rows));
  else await msg(env, chatId, t, KB(rows));
}

async function adminUserDetail(env, chatId, u) {
  const t = '👤 <b>کاربر</b>\n\n🆔 آیدی عددی: <code>' + u.tg_id + '</code>' +
    '\n👤 نام: ' + esc(u.first_name || '—') + (u.username ? ' (@' + esc(u.username) + ')' : '') +
    '\n💰 موجودی: <b>' + fmtToman(u.balance) + '</b>' +
    '\n🎁 درآمد نمایندگی: ' + fmtToman(u.earned || 0) +
    '\n👥 زیرمجموعه‌ها: ' + faNum(u.invited || 0) +
    '\n🛍 مجموع خرید: ' + fmtToman(u.total_spent || 0) +
    '\n📦 اشتراک‌ها: ' + faNum((u.subs || []).length) +
    '\n🚫 وضعیت: ' + (u.banned ? 'مسدود ⛔' : 'عادی ✅');
  const rows = [
    [BTN('➕ افزودن موجودی', 'u_add:' + u.tg_id), BTN('➖ کسر موجودی', 'u_sub:' + u.tg_id)]
  ];
  if (!isAdmin(env, u.tg_id)) rows.push([BTN(u.banned ? '✅ رفع مسدودیت' : '⛔ مسدود کردن', 'u_ban:' + u.tg_id)]);
  rows.push([BTN('◀️ پنل مدیریت', 'admin')]);
  await msg(env, chatId, t, KB(rows));
}

async function adminWithdraws(env, chatId, messageId) {
  const p = await kvGet(env, 'wpend', []);
  if (!p.length) {
    const kb = KB([[BTN('◀️ پنل مدیریت', 'admin')]]);
    if (messageId) await editMsg(env, chatId, messageId, '💸 درخواست برداشت بازی وجود ندارد.', kb);
    else await msg(env, chatId, '💸 درخواست برداشت بازی وجود ندارد.', kb);
    return;
  }
  const rows = [];
  for (const wid of p.slice().reverse().slice(0, 15)) {
    const w = await getWithdraw(env, wid);
    if (!w) continue;
    rows.push([BTN('#' + w.id + ' | ' + Number(w.amount).toLocaleString('en-US') + ' | ' + w.tg_id, 'w_v:' + w.id)]);
  }
  rows.push([BTN('◀️ پنل مدیریت', 'admin')]);
  const t = '💸 <b>درخواست‌های برداشت (' + faNum(p.length) + '):</b>';
  if (messageId) await editMsg(env, chatId, messageId, t, KB(rows));
  else await msg(env, chatId, t, KB(rows));
}

async function adminWithdrawDetail(env, chatId, messageId, wid) {
  const w = await getWithdraw(env, wid);
  if (!w) { await msg(env, chatId, '❌ پیدا نشد.'); return; }
  let t = '💸 <b>برداشت #' + w.id + '</b> — ' + (w.status === 'pending' ? '⏳ در انتظار' : esc(w.status)) +
    '\n👤 کاربر: <code>' + w.tg_id + '</code>' +
    '\n💵 مبلغ: <b>' + fmtToman(w.amount) + '</b>' +
    '\n💳 کارت مقصد: <code>' + esc(w.card || '—') + '</code>';
  const rows = [];
  if (w.status === 'pending') {
    rows.push([BTN('✅ پرداخت شد', 'w_ok:' + w.id), BTN('❌ رد (برگشت وجه)', 'w_no:' + w.id)]);
    t += '\n\n<i>بعد از واریز دستی، «پرداخت شد» را بزنید.</i>';
  }
  rows.push([BTN('◀️ برداشت‌ها', 'a_wd')]);
  if (messageId) await editMsg(env, chatId, messageId, t, KB(rows));
  else await msg(env, chatId, t, KB(rows));
}

async function adminSettings(env, chatId, messageId) {
  const cfg = await getCfg(env);
  const manualOn = cfg.card_manual_enabled !== false;
  const autoOn = cfg.card_auto_enabled === true;
  const autoReady = !!env.SHETAB_API_SECRET && !!cfg.card_number;
  const autoStatus = autoOn ? (autoReady ? 'روشن ✅' : 'روشن، ولی نیازمند کارت/Secret ⚠️') : 'خاموش ⛔';
  const t = '⚙️ <b>تنظیمات</b>\n\n' +
    '🤖 یوزرنیم ربات: ' + (cfg.bot_username ? '@' + esc(cfg.bot_username) : '—') +
    '\n📞 پشتیبانی: ' + (cfg.support ? '@' + esc(String(cfg.support).replace(/^@/, '')) : '—') +
    '\n🎁 درصد پورسانت: ' + faNum(cfg.commission) + '٪' +
    '\n💸 حداقل برداشت: ' + fmtToman(cfg.min_withdraw) +
    '\n\n💳 کارت‌به‌کارت دستی: ' + (manualOn ? 'روشن ✅' : 'خاموش ⛔') +
    '\n⚡ کارت‌به‌کارت خودکار: ' + autoStatus +
    '\n<i>روش خودکار برای خرید و تمدید است؛ روش دستی شامل ارسال رسید و شارژ کیف پول هم می‌شود.</i>';
  const rows = [
    [BTN('🤖 یوزرنیم ربات', 's_bot'), BTN('📞 پشتیبانی', 's_sup')],
    [BTN('🎁 درصد پورسانت', 's_com'), BTN('💸 حداقل برداشت', 's_minwd')],
    [BTN(manualOn ? '⛔ خاموش‌کردن کارت‌به‌کارت دستی' : '✅ روشن‌کردن کارت‌به‌کارت دستی', 's_pay_manual')],
    [BTN(autoOn ? '⛔ خاموش‌کردن کارت‌به‌کارت خودکار' : '✅ روشن‌کردن کارت‌به‌کارت خودکار', 's_pay_auto')],
    [BTN('◀️ پنل مدیریت', 'admin')]
  ];
  if (messageId) await editMsg(env, chatId, messageId, t, KB(rows));
  else await msg(env, chatId, t, KB(rows));
}

/* ============================ روتر callback ============================ */

async function onCallback(env, q, origin) {
  const data = q.data || '';
  const from = q.from || {};
  const chatId = q.message ? q.message.chat.id : from.id;
  const messageId = q.message ? q.message.message_id : null;
  const u = await ensureUser(env, from);
  const admEarly = isAdmin(env, from.id);
  if (admEarly && u.banned) { u.banned = false; await saveUser(env, u); } // خودترمیم: ادمین هیچ‌وقت مسدود نمی‌ماند

  if (u.banned && !data.startsWith('noop')) {
    await ansCb(env, q.id, '⛔ شما مسدود هستید.', true);
    return;
  }

  // دکمه‌های inline قدیمی ممکن است در پیام‌های قبلی هنوز دیده شوند؛ در حالت Mini App فقط پاسخ خنثی می‌دهیم.
  if (miniAppOnlyMode(env)) {
    await ansCb(env, q.id, 'جهت خرید وارد اپ فروش شوید.');
    if (q.message && q.message.chat && q.message.message_id != null) {
      try { await tg(env, 'editMessageReplyMarkup', { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } }); } catch (e) {}
    }
    const privateChat = !q.message || !q.message.chat || !q.message.chat.type || q.message.chat.type === 'private';
    if (privateChat) {
      try { await msg(env, chatId, 'جهت خرید وارد اپ فروش شوید.'); } catch (e) {}
    }
    return;
  }

  const adm = admEarly;
  const needAdmin = async () => {
    if (!adm) { await ansCb(env, q.id, '⛔ فقط ادمین!', true); return false; }
    return true;
  };

  // --- دکمه خنثی ---
  if (data === 'noop') { await ansCb(env, q.id, 'موجودی کافی نیست؛ از کارت‌به‌کارت استفاده کنید.'); return; }

  // --- کاربر ---
  if (data === 'home') { await ansCb(env, q.id); await showHome(env, chatId, u, messageId, origin, !q.message || !q.message.chat || !q.message.chat.type || q.message.chat.type === 'private'); return; }
  if (data === 'buy') { await ansCb(env, q.id); await showPanels(env, chatId, messageId); return; }
  if (data.startsWith('bp:')) { await ansCb(env, q.id); await showPlans(env, chatId, messageId, data.slice(3), null); return; }
  if (data.startsWith('bl:')) {
    const p = data.slice(3).split(':');
    await ansCb(env, q.id);
    await showPlanDetail(env, chatId, messageId, u, p[0], p[1], null);
    return;
  }
  if (data.startsWith('payw:')) {
    const p = data.slice(5).split(':');
    await ansCb(env, q.id, '⏳ در حال پردازش...');
    await walletBuy(env, u, p[0], p[1], messageId);
    return;
  }
  if (data.startsWith('payc:')) {
    const p = data.slice(5).split(':');
    await ansCb(env, q.id);
    await cardPayStart(env, chatId, u, 'buy', p[0], p[1]);
    return;
  }
  if (data.startsWith('payx:')) {
    const p = data.slice(5).split(':');
    await ansCb(env, q.id);
    await autoCardPayStart(env, chatId, u, 'buy', p[0], p[1]);
    return;
  }
  if (data === 'mysubs') { await ansCb(env, q.id); await showMySubs(env, chatId, messageId, u); return; }
  if (data.startsWith('sub:')) { await ansCb(env, q.id); await showSubDetail(env, chatId, messageId, u, data.slice(4)); return; }
  if (data.startsWith('cfg:')) {
    await ansCb(env, q.id, '⏳ در حال دریافت...');
    const sub = await getSub(env, data.slice(4));
    if (!sub) { await ansCb(env, q.id, 'پیدا نشد', true); return; }
    const panels = await getPanels(env);
    const panel = panels[sub.panel_id];
    const cfgs = panel ? await tryFetchConfigs(panel, sub.uuid) : null;
    if (cfgs) {
      try { await sendDoc(env, chatId, 'configs-' + sub.sid + '.txt', cfgs, '📡 کانفیگ‌های اشتراک شما'); }
      catch (e) { await msg(env, chatId, '❌ ارسال فایل ممکن نشد. از لینک اشتراک استفاده کنید.'); }
    } else {
      await msg(env, chatId, 'ℹ️ دریافت خودکار کانفیگ برای این سرور پشتیبانی نمی‌شود.\nاز «صفحه کاربری» (همان لینک اشتراک) در مرورگر استفاده کنید:\n<code>' + esc(userLink(panel, sub.uuid)) + '</code>');
    }
    return;
  }
  if (data.startsWith('rnw:')) { await ansCb(env, q.id); await showPlans(env, chatId, messageId, (await getSub(env, data.slice(4)) || {}).panel_id, data.slice(4)); return; }
  if (data.startsWith('rp:')) {
    const p = data.slice(3).split(':');
    const sub = await getSub(env, p[0]);
    await ansCb(env, q.id);
    if (!sub) return;
    await showPlanDetail(env, chatId, messageId, u, sub.panel_id, p[1], p[0]);
    return;
  }
  if (data.startsWith('rpayw:')) {
    const p = data.slice(6).split(':');
    await ansCb(env, q.id, '⏳ در حال پردازش...');
    await walletRenew(env, u, p[0], p[1], messageId);
    return;
  }
  if (data.startsWith('rpayc:')) {
    const p = data.slice(6).split(':');
    await ansCb(env, q.id);
    await cardPayStart(env, chatId, u, 'renew', p[0], p[1]);
    return;
  }
  if (data.startsWith('rpayx:')) {
    const p = data.slice(6).split(':');
    await ansCb(env, q.id);
    await autoCardPayStart(env, chatId, u, 'renew', p[0], p[1]);
    return;
  }
  if (data.startsWith('sdel:')) {
    await ansCb(env, q.id);
    const sid = data.slice(5);
    await editMsg(env, chatId, messageId, '🗑 آیا از <b>حذف کامل</b> این اشتراک مطمئنید؟\nاین کار قابل بازگشت نیست!', KB([[BTN('✅ بله، حذف کن', 'sdelgo:' + sid), BTN('❌ انصراف', 'sub:' + sid)]]));
    return;
  }
  if (data.startsWith('sdelgo:')) {
    const sid = data.slice(7);
    await ansCb(env, q.id, '⏳');
    const result = await deleteCustomerSubscription(env, u.tg_id, sid);
    if (!result.ok) {
      const messages = {
        subscription_not_found: '❌ اشتراک پیدا نشد.',
        subscription_has_pending_order: '⚠️ برای این اشتراک سفارش پرداخت‌نشده وجود دارد؛ ابتدا همان سفارش را پیگیری کنید و دوباره پرداخت نکنید.',
        subscription_delete_processing: '⏳ حذف قبلی هنوز در حال انجام است؛ چند لحظه بعد وضعیت را بررسی کنید.',
        subscription_panel_unavailable: '❌ پنل این اشتراک در دسترس نیست؛ برای جلوگیری از باقی‌ماندن سرویس، حذف محلی انجام نشد.',
        subscription_delete_failed: '❌ حذف سرویس از پنل ناموفق بود؛ اشتراک و دسترسی دست‌نخورده باقی ماندند.'
      };
      await editMsg(env, chatId, messageId, messages[result.error] || '❌ حذف اشتراک انجام نشد.', KB([[BTN('◀️ بازگشت', 'sub:' + sid)]]));
      return;
    }
    await editMsg(env, chatId, messageId, '🗑 اشتراک و دسترسی آن از پنل حذف شد. بازگشت وجه خودکار انجام نمی‌شود.', KB([[BTN('◀️ اشتراک‌های من', 'mysubs')]]));
    return;
  }
  if (data === 'wallet') { await ansCb(env, q.id); await showWallet(env, chatId, messageId, u); return; }
  if (data === 'chg') { await ansCb(env, q.id); await showCharge(env, chatId, messageId); return; }
  if (data.startsWith('chg:')) {
    await ansCb(env, q.id);
    await cardPayStart(env, chatId, u, 'charge', data.slice(4));
    return;
  }
  if (data === 'chgc') {
    await ansCb(env, q.id);
    await setState(env, u.tg_id, 'chg_amt', {});
    await msg(env, chatId, '✏️ مبلغ شارژ را به <b>تومان</b> بفرستید (فقط عدد، مثلاً 120000):', KB([[BTN('❌ انصراف', 'home')]]));
    return;
  }
  if (data === 'ref') { await ansCb(env, q.id); await showRef(env, chatId, messageId, u); return; }
  if (data === 'wd') {
    await ansCb(env, q.id);
    const cfg = await getCfg(env);
    if ((u.balance || 0) < cfg.min_withdraw) {
      await msg(env, chatId, '❌ موجودی شما کمتر از حداقل برداشت (' + fmtToman(cfg.min_withdraw) + ') است.\n💰 موجودی: ' + fmtToman(u.balance));
      return;
    }
    await setState(env, u.tg_id, 'wd_amt', {});
    await msg(env, chatId, '💸 مبلغ برداشت را به تومان بفرستید:\n💰 موجودی: ' + fmtToman(u.balance) + '\nحداقل: ' + fmtToman(cfg.min_withdraw), KB([[BTN('❌ انصراف', 'home')]]));
    return;
  }
  if (data === 'help') { await ansCb(env, q.id); await editMsg(env, chatId, messageId, helpText(), KB([[BTN('📥 دانلود اپ‌ها', 'apps')], [BTN('◀️ برگشت', 'home')]])); return; }
  if (data === 'apps') { await ansCb(env, q.id); await editMsg(env, chatId, messageId, appsText(), KB([[BTN('◀️ برگشت', 'home')]])); return; }
  if (data === 'sup') { await ansCb(env, q.id); const cfg = await getCfg(env); await editMsg(env, chatId, messageId, supportText(cfg), KB([[BTN('◀️ برگشت', 'home')]])); return; }

  // --- ادمین ---
  if (data === 'admin') { if (!await needAdmin()) return; await ansCb(env, q.id); await adminHome(env, chatId, messageId); return; }
  if (data === 'a_stats') { if (!await needAdmin()) return; await ansCb(env, q.id); await adminStats(env, chatId, messageId); return; }
  if (data === 'a_orders') { if (!await needAdmin()) return; await ansCb(env, q.id); await adminOrders(env, chatId, messageId); return; }
  if (data.startsWith('a_ord:')) { if (!await needAdmin()) return; await ansCb(env, q.id); await adminOrderDetail(env, chatId, messageId, data.slice(6)); return; }
  if (data.startsWith('a_ok:')) {
    if (!await needAdmin()) return;
    await ansCb(env, q.id, '⏳ در حال پردازش...');
    await doApprove(env, from.id, data.slice(5), q.message || null);
    return;
  }
  if (data.startsWith('a_no:')) {
    if (!await needAdmin()) return;
    await ansCb(env, q.id);
    const oid = data.slice(5);
    await setState(env, from.id, 'no_reason', { oid: oid });
    await msg(env, chatId, '📝 دلیل رد سفارش <code>' + oid + '</code> را بفرستید (یا بدون دلیل رد کنید):', KB([[BTN('⏭ رد بدون دلیل', 'a_nogo:' + oid)], [BTN('❌ انصراف', 'a_ord:' + oid)]]));
    return;
  }
  if (data.startsWith('a_nogo:')) {
    if (!await needAdmin()) return;
    await ansCb(env, q.id);
    await clearState(env, from.id);
    await doReject(env, from.id, data.slice(7), '');
    return;
  }
  if (data.startsWith('a_rcp:')) {
    if (!await needAdmin()) return;
    const o = await getOrder(env, data.slice(6));
    await ansCb(env, q.id);
    if (o && o.receipt_file_id) {
      try { await sendPhoto(env, chatId, o.receipt_file_id, '🧾 رسید سفارش <code>' + o.id + '</code>'); } catch (e) {}
    } else await msg(env, chatId, 'رسید تصویری ثبت نشده.');
    return;
  }
  if (data.startsWith('a_orddel:')) {
    if (!await needAdmin()) return;
    await ansCb(env, q.id);
    const oid = data.slice(9);
    const o = await getOrder(env, oid);
    if (o) {
      o.status = 'cancelled';
      o.cancelled_at = Date.now();
      o.cancelled_by = String(from.id);
      await saveOrder(env, o);
      // سفارش را از دیتابیس حذف نمی‌کنیم تا سابقهٔ گزارش و پیگیری مالی باقی بماند.
      await editMsg(env, chatId, messageId, '🗃 سفارش <code>' + oid + '</code> لغو و بایگانی شد.', KB([[BTN('◀️ سفارش‌ها', 'a_orders')]]));
      try { await msg(env, o.tg_id, '❌ سفارش <code>' + oid + '</code> لغو شد. برای پیگیری به پشتیبانی پیام بدید.'); } catch (e) {}
    }
    return;
  }
  if (data === 'a_panels') { if (!await needAdmin()) return; await ansCb(env, q.id); await adminPanels(env, chatId, messageId); return; }
  if (data.startsWith('a_p:')) { if (!await needAdmin()) return; await ansCb(env, q.id); await adminPanelDetail(env, chatId, messageId, data.slice(4)); return; }
  if (data === 'a_pa_add') {
    if (!await needAdmin()) return;
    await ansCb(env, q.id);
    await setState(env, from.id, 'p_name', {});
    await msg(env, chatId, '➕ <b>افزودن پنل جدید</b>\n\nقدم ۱ از ۴: <b>نام سرور</b> را بفرستید:\n<i>مثال: آلمان - سرور ۱</i>', KB([[BTN('❌ انصراف', 'a_panels')]]));
    return;
  }
  if (data.startsWith('a_ptest:')) {
    if (!await needAdmin()) return;
    await ansCb(env, q.id, '⏳ تست...');
    const panels = await getPanels(env);
    const p = panels[data.slice(8)];
    if (!p) return;
    try {
      const me = await hTest(p);
      await msg(env, chatId, '✅ <b>اتصال موفق!</b>\n🖥 ' + esc(p.name) + '\n👤 ادمین پنل: ' + esc((me && (me.name || me.uuid)) || '?') + '\n🔑 حالت: ' + esc((me && me.mode) || '?'));
    } catch (e) {
      await msg(env, chatId, '❌ <b>اتصال ناموفق!</b>\n🖥 ' + esc(p.name) + '\n<code>' + esc(String(e.message).slice(0, 600)) + '</code>\n\n<i>آدرس API و کلید را بررسی کنید.</i>');
    }
    return;
  }
  if (data.startsWith('a_pst:')) {
    if (!await needAdmin()) return;
    await ansCb(env, q.id, '⏳...');
    const panels = await getPanels(env);
    const p = panels[data.slice(6)];
    if (!p) return;
    try {
      const st = await hStatus(p);
      let t = '📊 <b>وضعیت سرور ' + esc(p.name) + '</b>\n\n<code>' + esc(JSON.stringify(st, null, 1)).slice(0, 3000) + '</code>';
      await msg(env, chatId, t);
    } catch (e) {
      await msg(env, chatId, '❌ خطا:\n<code>' + esc(String(e.message).slice(0, 500)) + '</code>');
    }
    return;
  }
  if (data.startsWith('a_pt:')) {
    if (!await needAdmin()) return;
    const panels = await getPanels(env);
    const p = panels[data.slice(5)];
    if (!p) return;
    p.enabled = p.enabled === false ? true : false;
    await savePanels(env, panels);
    await ansCb(env, q.id, p.enabled ? 'فعال شد ✅' : 'غیرفعال شد ⛔');
    await adminPanelDetail(env, chatId, messageId, p.id);
    return;
  }
  if (data.startsWith('a_pdel:')) {
    if (!await needAdmin()) return;
    await ansCb(env, q.id);
    const pid = data.slice(7);
    await editMsg(env, chatId, messageId, '⚠️ پنل <code>' + pid + '</code> حذف شود؟\n(اشتراک‌های فروخته‌شده در پنل می‌مانند، فقط از ربات حذف می‌شود)', KB([[BTN('✅ بله حذف کن', 'a_pdelgo:' + pid), BTN('❌ انصراف', 'a_p:' + pid)]]));
    return;
  }
  if (data.startsWith('a_pdelgo:')) {
    if (!await needAdmin()) return;
    await ansCb(env, q.id);
    const panels = await getPanels(env);
    delete panels[data.slice(9)];
    await savePanels(env, panels);
    await adminPanels(env, chatId, messageId);
    return;
  }
  if (data === 'a_plans') { if (!await needAdmin()) return; await ansCb(env, q.id); await adminPlans(env, chatId, messageId); return; }
  if (data.startsWith('a_pl:')) { if (!await needAdmin()) return; await ansCb(env, q.id); await adminPlanDetail(env, chatId, messageId, data.slice(5)); return; }
  if (data === 'a_pla_add') {
    if (!await needAdmin()) return;
    await ansCb(env, q.id);
    await setState(env, from.id, 'pl_t', {});
    await msg(env, chatId, '➕ <b>افزودن پلن</b>\n\nقدم ۱ از ۵: <b>عنوان پلن</b> را بفرستید:\n<i>مثال: یک‌ماهه ۵۰ گیگ</i>', KB([[BTN('❌ انصراف', 'a_plans')]]));
    return;
  }
  if (data === 'a_plsamp') {
    if (!await needAdmin()) return;
    await ansCb(env, q.id, 'ساخته شد ✅');
    const plans = await getPlans(env);
    const samples = [
      { title: 'یک‌ماهه ۳۰ گیگ', gb: 30, days: 30, price: 90000 },
      { title: 'یک‌ماهه ۶۰ گیگ', gb: 60, days: 30, price: 140000 },
      { title: 'دو‌ماهه ۱۰۰ گیگ', gb: 100, days: 60, price: 240000 }
    ];
    for (const s of samples) {
      const id = uid(6);
      plans[id] = { id: id, title: s.title, gb: s.gb, days: s.days, price: s.price, panel_ids: ['all'], enabled: true };
    }
    await savePlans(env, plans);
    await adminPlans(env, chatId, messageId);
    return;
  }
  if (data.startsWith('a_plt:')) {
    if (!await needAdmin()) return;
    const plans = await getPlans(env);
    const p = plans[data.slice(6)];
    if (!p) return;
    p.enabled = p.enabled === false ? true : false;
    await savePlans(env, plans);
    await ansCb(env, q.id, p.enabled ? 'فعال شد ✅' : 'غیرفعال شد ⛔');
    await adminPlanDetail(env, chatId, messageId, p.id);
    return;
  }
  if (data.startsWith('a_pldel:')) {
    if (!await needAdmin()) return;
    await ansCb(env, q.id);
    await editMsg(env, chatId, messageId, '⚠️ این پلن حذف شود؟', KB([[BTN('✅ بله', 'a_pldelgo:' + data.slice(8)), BTN('❌ انصراف', 'a_pl:' + data.slice(8))]]));
    return;
  }
  if (data.startsWith('a_pldelgo:')) {
    if (!await needAdmin()) return;
    await ansCb(env, q.id);
    const plans = await getPlans(env);
    delete plans[data.slice(10)];
    await savePlans(env, plans);
    await adminPlans(env, chatId, messageId);
    return;
  }
  if (data === 'a_cards') { if (!await needAdmin()) return; await ansCb(env, q.id); await adminCards(env, chatId, messageId); return; }
  if (data === 'a_card_num') {
    if (!await needAdmin()) return;
    await ansCb(env, q.id);
    await setState(env, from.id, 'card_num', {});
    await msg(env, chatId, '💳 شماره کارت جدید را بفرستید (بدون فاصله):');
    return;
  }
  if (data === 'a_card_hold') {
    if (!await needAdmin()) return;
    await ansCb(env, q.id);
    await setState(env, from.id, 'card_hold', {});
    await msg(env, chatId, '👤 نام صاحب کارت را بفرستید:');
    return;
  }
  if (data === 'a_users') {
    if (!await needAdmin()) return;
    await ansCb(env, q.id);
    await setState(env, from.id, 'u_find', {});
    await msg(env, chatId, '👥 <b>جستجوی کاربر</b>\n\nآیدی عددی کاربر را بفرستید:', KB([[BTN('❌ انصراف', 'admin')]]));
    return;
  }
  if (data.startsWith('u_add:')) {
    if (!await needAdmin()) return;
    await ansCb(env, q.id);
    await setState(env, from.id, 'u_add_amt', { tgid: data.slice(6) });
    await msg(env, chatId, '➕ مبلغ افزایش موجودی (تومان) برای <code>' + esc(data.slice(6)) + '</code> را بفرستید:');
    return;
  }
  if (data.startsWith('u_sub:')) {
    if (!await needAdmin()) return;
    await ansCb(env, q.id);
    await setState(env, from.id, 'u_sub_amt', { tgid: data.slice(6) });
    await msg(env, chatId, '➖ مبلغ کسر از موجودی (تومان) برای <code>' + esc(data.slice(6)) + '</code> را بفرستید:');
    return;
  }
  if (data.startsWith('u_ban:')) {
    if (!await needAdmin()) return;
    const tu = await getUser(env, data.slice(6));
    if (!tu) { await ansCb(env, q.id, 'پیدا نشد', true); return; }
    if (isAdmin(env, tu.tg_id)) { await ansCb(env, q.id, '⛔ ادمین را نمی‌توان مسدود کرد!', true); return; }
    tu.banned = !tu.banned;
    await saveUser(env, tu);
    await recordCustomerActivity(env, tu.tg_id, tu.banned ? 'customer_banned' : 'customer_unbanned', { actor_id: from.id });
    await ansCb(env, q.id, tu.banned ? 'مسدود شد ⛔' : 'رفع مسدودیت ✅');
    await adminUserDetail(env, chatId, tu);
    return;
  }
  if (data === 'a_wd') { if (!await needAdmin()) return; await ansCb(env, q.id); await adminWithdraws(env, chatId, messageId); return; }
  if (data.startsWith('w_v:')) { if (!await needAdmin()) return; await ansCb(env, q.id); await adminWithdrawDetail(env, chatId, messageId, data.slice(4)); return; }
  if (data.startsWith('w_ok:')) {
    if (!await needAdmin()) return;
    await ansCb(env, q.id);
    const w = await getWithdraw(env, data.slice(5));
    if (w && w.status === 'pending') {
      w.status = 'approved';
      await saveWithdraw(env, w);
      await recordCustomerActivity(env, w.tg_id, 'withdrawal_approved', { amount: w.amount, actor_id: from.id });
      await editMsg(env, chatId, messageId, '✅ برداشت <code>' + w.id + '</code> انجام شد.', KB([[BTN('◀️ برداشت‌ها', 'a_wd')]]));
      try { await msg(env, w.tg_id, '✅ <b>برداشت شما واریز شد!</b>\n💵 مبلغ: ' + fmtToman(w.amount) + '\n💳 به کارت: <code>' + esc(w.card || '') + '</code>'); } catch (e) {}
    }
    return;
  }
  if (data.startsWith('w_no:')) {
    if (!await needAdmin()) return;
    await ansCb(env, q.id);
    const w = await getWithdraw(env, data.slice(5));
    if (w && w.status === 'pending') {
      w.status = 'rejected';
      await saveWithdraw(env, w);
      await recordCustomerActivity(env, w.tg_id, 'withdrawal_rejected', { amount: w.amount, actor_id: from.id });
      const tu = await getUser(env, w.tg_id);
      if (tu) { tu.balance = (tu.balance || 0) + w.amount; await saveUser(env, tu); }
      await editMsg(env, chatId, messageId, '🚫 برداشت <code>' + w.id + '</code> رد و مبلغ برگشت خورد.', KB([[BTN('◀️ برداشت‌ها', 'a_wd')]]));
      try { await msg(env, w.tg_id, '❌ درخواست برداشت شما رد شد و مبلغ به کیف پول برگشت خورد.'); } catch (e) {}
    }
    return;
  }
  if (data === 'a_bc') {
    if (!await needAdmin()) return;
    await ansCb(env, q.id);
    await setState(env, from.id, 'bc_text', {});
    await msg(env, chatId, '📢 متن پیام همگانی را بفرستید:\n<i>(برای همه کاربران ارسال می‌شود)</i>', KB([[BTN('❌ انصراف', 'admin')]]));
    return;
  }
  if (data === 'a_bcgo') {
    if (!await needAdmin()) return;
    await ansCb(env, q.id, '⏳ ارسال...');
    const st = await getState(env, from.id);
    await clearState(env, from.id);
    const text = st && st.data ? st.data.text : '';
    if (!text) { await msg(env, chatId, '❌ متنی ثبت نشده.'); return; }
    const keys = await kvList(env, 'u:');
    let ok = 0, fail = 0;
    await msg(env, chatId, '⏳ ارسال به ' + faNum(keys.length) + ' کاربر شروع شد...');
    for (const k of keys.slice(0, 1000)) {
      const tgid = k.slice(2);
      try { await tg(env, 'sendMessage', { chat_id: Number(tgid), text: text, parse_mode: 'HTML', disable_web_page_preview: true }); ok++; }
      catch (e) { fail++; }
    }
    await msg(env, chatId, '📢 اتمام ارسال.\n✅ موفق: ' + faNum(ok) + '\n❌ ناموفق: ' + faNum(fail));
    return;
  }
  if (data === 'a_set') { if (!await needAdmin()) return; await ansCb(env, q.id); await adminSettings(env, chatId, messageId); return; }
  if (data === 's_pay_manual') {
    if (!await needAdmin()) return;
    const cfg = await getCfg(env);
    cfg.card_manual_enabled = cfg.card_manual_enabled === false;
    await saveCfg(env, cfg);
    await ansCb(env, q.id, cfg.card_manual_enabled ? 'کارت‌به‌کارت دستی روشن شد ✅' : 'کارت‌به‌کارت دستی خاموش شد ⛔');
    await adminSettings(env, chatId, messageId);
    return;
  }
  if (data === 's_pay_auto') {
    if (!await needAdmin()) return;
    const cfg = await getCfg(env);
    if (cfg.card_auto_enabled !== true && !env.SHETAB_API_SECRET) {
      await ansCb(env, q.id, 'اول Secret با نام SHETAB_API_SECRET را در Cloudflare تنظیم کنید.', true);
      await adminSettings(env, chatId, messageId);
      return;
    }
    if (cfg.card_auto_enabled !== true && !cfg.card_number) {
      await ansCb(env, q.id, 'اول شماره کارت را در بخش کارت ثبت کنید.', true);
      await adminSettings(env, chatId, messageId);
      return;
    }
    cfg.card_auto_enabled = cfg.card_auto_enabled !== true;
    await saveCfg(env, cfg);
    await ansCb(env, q.id, cfg.card_auto_enabled ? 'کارت‌به‌کارت خودکار روشن شد ✅' : 'کارت‌به‌کارت خودکار خاموش شد ⛔');
    await adminSettings(env, chatId, messageId);
    return;
  }
  if (data === 's_bot') {
    if (!await needAdmin()) return;
    await ansCb(env, q.id);
    await setState(env, from.id, 's_bot_v', {});
    await msg(env, chatId, '🤖 یوزرنیم ربات را بدون @ بفرستید (مثلاً MyShopBot):');
    return;
  }
  if (data === 's_sup') {
    if (!await needAdmin()) return;
    await ansCb(env, q.id);
    await setState(env, from.id, 's_sup_v', {});
    await msg(env, chatId, '📞 آیدی پشتیبانی را بدون @ بفرستید:');
    return;
  }
  if (data === 's_com') {
    if (!await needAdmin()) return;
    await ansCb(env, q.id);
    await setState(env, from.id, 's_com_v', {});
    await msg(env, chatId, '🎁 درصد پورسانت نمایندگی را بفرستید (عدد، مثلاً 10):');
    return;
  }
  if (data === 's_minwd') {
    if (!await needAdmin()) return;
    await ansCb(env, q.id);
    await setState(env, from.id, 's_minwd_v', {});
    await msg(env, chatId, '💸 حداقل مبلغ برداشت (تومان) را بفرستید:');
    return;
  }

  await ansCb(env, q.id);
}

/* ============================ ورودی متنی/عکس (state) ============================ */

async function onStateText(env, u, chatId, text) {
  const st = await getState(env, u.tg_id);
  if (!st) return false;
  const step = st.step;
  const d = st.data || {};
  const adm = isAdmin(env, u.tg_id);

  // رسید متنی خرید/تمدید
  if (step === 'rcp') {
    if (!text || text.length < 3) { await msg(env, chatId, '❌ رسید معتبر نیست. عکس رسید یا شماره پیگیری را بفرستید.'); return true; }
    try { await submitReceiptOrder(env, u, d, { file_id: null, text: text.slice(0, 500) }); }
    catch (e) { await msg(env, chatId, '❌ خطا در ثبت سفارش. دوباره تلاش کنید.'); }
    return true;
  }
  // مبلغ دلخواه شارژ
  if (step === 'chg_amt') {
    const n = parseMoney(text);
    if (!n || n < 10000) { await msg(env, chatId, '❌ مبلغ نامعتبر است. حداقل ۱۰٬۰۰۰ تومان (فقط عدد):'); return true; }
    await clearState(env, u.tg_id);
    await cardPayStart(env, chatId, u, 'charge', n);
    return true;
  }
  // رسید متنی شارژ
  if (step === 'chg_rcp') {
    if (!text || text.length < 3) { await msg(env, chatId, '❌ رسید معتبر نیست.'); return true; }
    try { await submitReceiptOrder(env, u, { amount: d.amount }, { file_id: null, text: text.slice(0, 500) }); }
    catch (e) { await msg(env, chatId, '❌ خطا در ثبت. دوباره تلاش کنید.'); }
    return true;
  }
  // برداشت
  if (step === 'wd_amt') {
    const cfg = await getCfg(env);
    const n = parseMoney(text);
    if (!n || n < cfg.min_withdraw) { await msg(env, chatId, '❌ مبلغ باید حداقل ' + fmtToman(cfg.min_withdraw) + ' باشد:'); return true; }
    if (n > (u.balance || 0)) { await msg(env, chatId, '❌ مبلغ بیشتر از موجودی است. موجودی: ' + fmtToman(u.balance)); return true; }
    await setState(env, u.tg_id, 'wd_card', { amount: n });
    await msg(env, chatId, '💳 شماره کارت مقصد (۱۶ رقم) را بفرستید:');
    return true;
  }
  if (step === 'wd_card') {
    const card = normDigits(text).replace(/[^\d]/g, '');
    if (card.length < 12) { await msg(env, chatId, '❌ شماره کارت معتبر نیست:'); return true; }
    const amount = Number(d.amount);
    if (amount > (u.balance || 0)) { await clearState(env, u.tg_id); await msg(env, chatId, '❌ موجودی کافی نیست.'); return true; }
    u.balance -= amount;
    await saveUser(env, u);
    const w = await newWithdraw(env, { tg_id: u.tg_id, amount: amount, card: card });
    await clearState(env, u.tg_id);
    await msg(env, chatId, '✅ <b>درخواست برداشت ثبت شد!</b>\n\n💵 مبلغ: ' + fmtToman(amount) + '\n💳 کارت: <code>' + card + '</code>\n⏳ بعد از واریز دستی توسط ادمین، اینجا اطلاع‌رسانی می‌شود.', KB([[BTN('🏠 منوی اصلی', 'home')]]));
    try { await notifyAdmins(env, '💸 <b>درخواست برداشت #' + w.id + '</b>\n👤 <code>' + u.tg_id + '</code>\n💵 ' + fmtToman(amount) + '\n💳 <code>' + card + '</code>', KB([[BTN('🔍 بررسی', 'w_v:' + w.id)]])); } catch (e) {}
    return true;
  }

  // --- ویزارد افزودن پنل (ادمین) ---
  if (step === 'p_name' && adm) {
    if (!text || text.length < 2) { await msg(env, chatId, '❌ نام معتبر نیست:'); return true; }
    await setState(env, u.tg_id, 'p_api', { name: text.slice(0, 60) });
    await msg(env, chatId, 'قدم ۲ از ۴: <b>آدرس API پنل</b> را بفرستید:\n\n<i>از لینک ادمین پنل، بخش دامنه + مسیر پروکسی (بدون UUID و بدون admin/)</i>\nمثال:\n<code>https://sub.example.com/AbC123XyZ</code>', KB([[BTN('❌ انصراف', 'a_panels')]]));
    return true;
  }
  if (step === 'p_api' && adm) {
    let v = extractUrl(text) || cleanText(text);
    if (v && !/^https?:\/\//i.test(v)) v = 'https://' + v; // اگر https را جا انداخت
    v = v.replace(/\/+$/, '');
    if (!/^https?:\/\/.+\/.+/.test(v)) { await msg(env, chatId, '❌ آدرس معتبر نیست. چیزی که رسید:\n<code>' + esc(cleanText(text)).slice(0, 120) + '</code>\n\nمثال درست:\n<code>https://sub.example.com/AbC123XyZ</code>'); return true; }
    await setState(env, u.tg_id, 'p_key', { name: d.name, api: v });
    await msg(env, chatId, 'قدم ۳ از ۴: <b>کلید API (UUID ادمین)</b> را بفرستید:\n\n<i>همان UUID داخل لینک ادمین، یا از بخش Admins پنل</i>\nمثال:\n<code>8bncvfb5-8193-vv76-ab97-4c35965l250m</code>', KB([[BTN('❌ انصراف', 'a_panels')]]));
    return true;
  }
  if (step === 'p_key' && adm) {
    const v = cleanText(text).replace(/[^0-9a-fA-F-]/g, '');
    if (!/^[0-9a-fA-F-]{30,}/.test(v)) { await msg(env, chatId, '❌ کلید معتبر نیست (باید UUID باشد، مثل <code>8bncvfb5-8193-vv76-ab97-4c35965l250m</code>):'); return true; }
    await msg(env, chatId, '⏳ در حال تست اتصال به پنل...');
    try {
      const me = await hTest({ api_base: d.api, api_key: v });
      await setState(env, u.tg_id, 'p_ub', { name: d.name, api: d.api, key: v, admin: (me && (me.name || me.uuid)) || '؟' });
      await msg(env, chatId, '✅ اتصال به پنل تأیید شد! (ادمین: ' + esc((me && (me.name || me.uuid)) || '؟') + ')\n\nقدم ۴ از ۴: <b>آدرس پایه لینک یوزرها</b> را بفرستید:\n\n<i>در پنل یک یوزر تستی بسازید و لینکش را کپی کنید؛ مثلاً:</i>\n<code>https://sub.example.com/XyZ456/&lt;uuid&gt;/</code>\n<i>شما فقط این بخش را بفرستید (می‌توانید کامل هم بفرستید؛ خودش تمیزش می‌کند):</i>\n<code>https://sub.example.com/XyZ456</code>', KB([[BTN('❌ انصراف', 'a_panels')]]));
    } catch (e) {
      const m = String((e && e.message) || '');
      if (m.indexOf('401') >= 0 || m.toLowerCase().indexOf('unauthorized') >= 0) {
        await msg(env, chatId, '🔑 <b>کلید API اشتباه است!</b>\n\nآدرس پنل درست است و سرور جواب داد، ولی این کلید را قبول نکرد.\n\n<i>کلید باید UUID ادمین (۳۶ کاراکتر) باشد — از لینک ورود ادمین پنل یا بخش Admins کپی کنید. اگر رمز ادمین عوض شده، UUID قبلی دیگر معتبر نیست.</i>\n\nکلید درست را دوباره بفرستید (یا /cancel):');
      } else {
        await msg(env, chatId, '❌ <b>اتصال به پنل ناموفق!</b>\n<code>' + esc(m.slice(0, 400)) + '</code>\n\n<i>احتمالاً <b>آدرس API (قدم ۲)</b> اشتباه است. از اول شروع کنید.</i>', KB([[BTN('🔄 شروع دوباره', 'a_pa_add')]]));
        await clearState(env, u.tg_id);
      }
    }
    return true;
  }
  if (step === 'p_ub' && adm) {
    let v = extractUrl(text) || cleanText(text);
    if (v && !/^https?:\/\//i.test(v)) v = 'https://' + v; // اگر https را جا انداخت
    v = stripTrailingUuid(v).replace(/\/+$/, '');
    if (!/^https?:\/\/.+/.test(v)) { await msg(env, chatId, '❌ آدرس معتبر نیست. چیزی که رسید:\n<code>' + esc(cleanText(text)).slice(0, 120) + '</code>\n\nمثال درست:\n<code>https://sub.example.com/XyZ456</code>\n<i>می‌توانید لینک کامل یوزر را هم بفرستید؛ خودش تمیزش می‌کند.</i>'); return true; }
    const panel = { id: uid(6), name: d.name, api_base: d.api, api_key: d.key, user_base: v, enabled: true };
    const panels = await getPanels(env);
    panels[panel.id] = panel;
    await savePanels(env, panels);
    await clearState(env, u.tg_id);
    await msg(env, chatId, '✅ <b>پنل اضافه شد!</b>\n\n🖥 ' + esc(panel.name) + ' — <code>' + panel.id + '</code>\n👤 ادمین پنل: ' + esc(d.admin || '؟') + '\n🔗 پایه لینک یوزرها: <code>' + esc(panel.user_base) + '</code>', KB([[BTN('🖥 مدیریت پنل‌ها', 'a_panels')]]));
    return true;
  }

  // --- ویزارد افزودن پلن ---
  if (step === 'pl_t' && adm) {
    if (!text || text.length < 2) { await msg(env, chatId, '❌ عنوان معتبر نیست:'); return true; }
    await setState(env, u.tg_id, 'pl_g', { t: text.slice(0, 60) });
    await msg(env, chatId, 'قدم ۲ از ۵: <b>حجم پلن (گیگ)</b> را بفرستید:\n<i>عدد، مثلاً 50 — برای نامحدود عدد 0</i>', KB([[BTN('❌ انصراف', 'a_plans')]]));
    return true;
  }
  if (step === 'pl_g' && adm) {
    const n = parseNum(text);
    if (n == null || n < 0 || n > 1000000) { await msg(env, chatId, '❌ حجم نامعتبر است (عدد، 0 یعنی نامحدود):'); return true; }
    await setState(env, u.tg_id, 'pl_d', { t: d.t, g: n });
    await msg(env, chatId, 'قدم ۳ از ۵: <b>مدت پلن (روز)</b> را بفرستید:\n<i>مثلاً 30</i>');
    return true;
  }
  if (step === 'pl_d' && adm) {
    const n = parseMoney(text);
    if (!n || n < 1 || n > 3650) { await msg(env, chatId, '❌ مدت نامعتبر است (۱ تا ۳۶۵۰ روز):'); return true; }
    await setState(env, u.tg_id, 'pl_p', { t: d.t, g: d.g, dd: n });
    await msg(env, chatId, 'قدم ۴ از ۵: <b>قیمت (تومان)</b> را بفرستید:\n<i>مثلاً 120000</i>');
    return true;
  }
  if (step === 'pl_p' && adm) {
    const n = parseMoney(text);
    if (!n || n < 0) { await msg(env, chatId, '❌ قیمت نامعتبر است:'); return true; }
    const panels = await getPanels(env);
    const arr = Object.values(panels);
    let t = 'قدم ۵ از ۵: این پلن برای کدام سرورها فعال باشد؟\n\n';
    if (!arr.length) t += '<i>هنوز پنلی ثبت نشده؛ کلمه <code>all</code> را بفرستید تا بعداً برای همه فعال باشد.</i>';
    else {
      t += 'کد سرورها را با کاما بفرستید، یا <code>all</code> برای همه:\n';
      for (const p of arr) t += '\n• ' + esc(p.name) + ' — <code>' + p.id + '</code>';
    }
    await setState(env, u.tg_id, 'pl_pn', { t: d.t, g: d.g, dd: d.dd, p: n });
    await msg(env, chatId, t);
    return true;
  }
  if (step === 'pl_pn' && adm) {
    const v = text.trim().toLowerCase();
    const panels = await getPanels(env);
    let ids;
    if (v === 'all') ids = ['all'];
    else {
      ids = v.split(/[,\s]+/).map((x) => x.trim().toUpperCase()).filter((x) => panels[x]);
      if (!ids.length) { await msg(env, chatId, '❌ کد معتبری پیدا نشد. دوباره بفرستید یا all:'); return true; }
    }
    const plans = await getPlans(env);
    const id = uid(6);
    plans[id] = { id: id, title: d.t, gb: d.g, days: d.dd, price: d.p, panel_ids: ids, enabled: true };
    await savePlans(env, plans);
    await clearState(env, u.tg_id);
    await msg(env, chatId, '✅ <b>پلن ساخته شد!</b>\n' + planLine(plans[id]), KB([[BTN('📦 مدیریت پلن‌ها', 'a_plans')]]));
    return true;
  }

  // --- کارت ---
  if (step === 'card_num' && adm) {
    const v = normDigits(text).replace(/[^\d\s]/g, '').trim();
    if (v.replace(/\s/g, '').length < 12) { await msg(env, chatId, '❌ شماره کارت معتبر نیست:'); return true; }
    const cfg = await getCfg(env);
    cfg.card_number = v;
    await saveCfg(env, cfg);
    await clearState(env, u.tg_id);
    await msg(env, chatId, '✅ شماره کارت ذخیره شد.', KB([[BTN('💳 کارت', 'a_cards')]]));
    return true;
  }
  if (step === 'card_hold' && adm) {
    const cfg = await getCfg(env);
    cfg.card_holder = text.slice(0, 60);
    await saveCfg(env, cfg);
    await clearState(env, u.tg_id);
    await msg(env, chatId, '✅ نام صاحب کارت ذخیره شد.', KB([[BTN('💳 کارت', 'a_cards')]]));
    return true;
  }

  // --- جستجوی کاربر ---
  if (step === 'u_find' && adm) {
    const tgid = normDigits(text).replace(/[^\d]/g, '');
    const tu = await getUser(env, tgid);
    await clearState(env, u.tg_id);
    if (!tu) { await msg(env, chatId, '❌ کاربری با این آیدی در ربات پیدا نشد.'); return true; }
    await adminUserDetail(env, chatId, tu);
    return true;
  }
  if (step === 'u_add_amt' && adm) {
    const n = parseMoney(text);
    if (!n || n <= 0) { await msg(env, chatId, '❌ مبلغ نامعتبر:'); return true; }
    const tu = await getUser(env, d.tgid);
    await clearState(env, u.tg_id);
    if (!tu) { await msg(env, chatId, '❌ کاربر پیدا نشد.'); return true; }
    tu.balance = (tu.balance || 0) + n;
    await saveUser(env, tu);
    await recordLedgerSafely(env, { id: 'admin-' + uid(10), kind: 'wallet_adjustment', type: 'admin_credit', tg_id: String(tu.tg_id), amount: n, payment_method: 'admin', actor_id: String(u.tg_id), balance_after: tu.balance, occurred_at: Date.now() });
    await recordCustomerActivity(env, tu.tg_id, 'wallet_credit_admin', { amount: n, actor_id: u.tg_id });
    await msg(env, chatId, '✅ ' + fmtToman(n) + ' به موجودی <code>' + tu.tg_id + '</code> اضافه شد.\nموجودی فعلی: ' + fmtToman(tu.balance));
    try { await msg(env, tu.tg_id, '💰 <b>کیف پول شما شارژ شد!</b>\n➕ مبلغ: ' + fmtToman(n) + '\n💰 موجودی: ' + fmtToman(tu.balance)); } catch (e) {}
    return true;
  }
  if (step === 'u_sub_amt' && adm) {
    const n = parseMoney(text);
    if (!n || n <= 0) { await msg(env, chatId, '❌ مبلغ نامعتبر:'); return true; }
    const tu = await getUser(env, d.tgid);
    await clearState(env, u.tg_id);
    if (!tu) { await msg(env, chatId, '❌ کاربر پیدا نشد.'); return true; }
    const oldBalance = Number(tu.balance || 0);
    tu.balance = Math.max(0, oldBalance - n);
    const deducted = oldBalance - tu.balance;
    await saveUser(env, tu);
    if (deducted > 0) {
      await recordLedgerSafely(env, { id: 'admin-' + uid(10), kind: 'wallet_adjustment', type: 'admin_debit', tg_id: String(tu.tg_id), amount: deducted, payment_method: 'admin', actor_id: String(u.tg_id), balance_after: tu.balance, occurred_at: Date.now() });
      await recordCustomerActivity(env, tu.tg_id, 'wallet_debit_admin', { amount: deducted, actor_id: u.tg_id });
    }
    await msg(env, chatId, '✅ ' + fmtToman(deducted) + ' از موجودی <code>' + tu.tg_id + '</code> کسر شد.\nموجودی فعلی: ' + fmtToman(tu.balance));
    return true;
  }

  // --- دلیل رد ---
  if (step === 'no_reason' && adm) {
    await clearState(env, u.tg_id);
    await doReject(env, u.tg_id, d.oid, text.slice(0, 300));
    return true;
  }

  // --- همگانی ---
  if (step === 'bc_text' && adm) {
    if (!text || text.length < 2) { await msg(env, chatId, '❌ متن کوتاه است:'); return true; }
    await setState(env, u.tg_id, 'bc_go', { text: text.slice(0, 3500) });
    await msg(env, chatId, '👁 <b>پیش‌نمایش:</b>\n\n' + esc(text.slice(0, 3500)) + '\n\nارسال شود؟', KB([[BTN('✅ بله، ارسال کن', 'a_bcgo'), BTN('❌ انصراف', 'admin')]]));
    return true;
  }

  // --- تنظیمات ---
  if (step === 's_bot_v' && adm) {
    const cfg = await getCfg(env);
    cfg.bot_username = cleanText(text).replace(/^@/, '');
    await saveCfg(env, cfg);
    await clearState(env, u.tg_id);
    await msg(env, chatId, '✅ ذخیره شد.', KB([[BTN('◀️ تنظیمات', 'a_set')]]));
    return true;
  }
  if (step === 's_sup_v' && adm) {
    const cfg = await getCfg(env);
    cfg.support = cleanText(text).replace(/^@/, '');
    await saveCfg(env, cfg);
    await clearState(env, u.tg_id);
    await msg(env, chatId, '✅ ذخیره شد.', KB([[BTN('◀️ تنظیمات', 'a_set')]]));
    return true;
  }
  if (step === 's_com_v' && adm) {
    const n = parseNum(text);
    if (n == null || n < 0 || n > 90) { await msg(env, chatId, '❌ عدد ۰ تا ۹۰ بفرستید:'); return true; }
    const cfg = await getCfg(env);
    cfg.commission = n;
    await saveCfg(env, cfg);
    await clearState(env, u.tg_id);
    await msg(env, chatId, '✅ پورسانت ' + faNum(n) + '٪ شد.', KB([[BTN('◀️ تنظیمات', 'a_set')]]));
    return true;
  }
  if (step === 's_minwd_v' && adm) {
    const n = parseMoney(text);
    if (!n || n < 0) { await msg(env, chatId, '❌ مبلغ نامعتبر:'); return true; }
    const cfg = await getCfg(env);
    cfg.min_withdraw = n;
    await saveCfg(env, cfg);
    await clearState(env, u.tg_id);
    await msg(env, chatId, '✅ ذخیره شد.', KB([[BTN('◀️ تنظیمات', 'a_set')]]));
    return true;
  }

  return false;
}

async function onStatePhoto(env, u, chatId, fileId) {
  const st = await getState(env, u.tg_id);
  if (!st) return false;
  if (st.step === 'rcp') {
    try { await submitReceiptOrder(env, u, st.data || {}, { file_id: fileId, text: null }); }
    catch (e) { await msg(env, chatId, '❌ خطا در ثبت سفارش.'); }
    return true;
  }
  if (st.step === 'chg_rcp') {
    try { await submitReceiptOrder(env, u, { amount: (st.data || {}).amount }, { file_id: fileId, text: null }); }
    catch (e) { await msg(env, chatId, '❌ خطا در ثبت.'); }
    return true;
  }
  return false;
}

/* ============================ پیام‌ها ============================ */

async function onMessage(env, m, origin) {
  const chatId = m.chat.id;
  const from = m.from || {};

  // فقط چت خصوصی
  if (m.chat.type !== 'private') {
    try { await msg(env, chatId, '🤖 لطفاً از ربات در چت خصوصی استفاده کنید.'); } catch (e) {}
    return;
  }

  const u = await ensureUser(env, from);
  if (u.referral_join_eligible === true && u.referral_join_rewarded !== true) await ensureReferralJoinAward(env, u);
  if (isAdmin(env, from.id)) {
    if (u.banned) { u.banned = false; await saveUser(env, u); } // ادمین هیچ‌وقت مسدود نمی‌شود
  } else if (u.banned) {
    await msg(env, chatId, '⛔ شما مسدود هستید.');
    return;
  }

  const text = (m.text || '').trim();
  await ensureMiniAppMenuButton(env, u, chatId, origin);

  if (miniAppOnlyMode(env)) {
    if (/^\/start(?:@\w+)?(?:\s|$)/.test(text)) {
      const payload = text.split(/\s+/)[1] || '';
      // پیوند نمایندگی یک‌بارمصرف است؛ نقش در KV ثبت می‌شود و Mini App همان‌جا دسترسی می‌دهد.
      if (payload.startsWith('agent_')) {
        const accepted = await acceptAgentInvite(env, u, payload.slice(6));
        await msg(env, chatId, accepted.ok ? '✅ نمایندگی برای این حساب فعال شد. از دکمهٔ «ورود به اپ» پنل نماینده را باز کنید.' : '⚠️ لینک دعوت نمایندگی نامعتبر، منقضی یا قبلاً استفاده شده است.');
      }
      // انتساب امن یک‌بارهٔ عضو جدید به معرف؛ ثبت امتیاز نیز رویداد idempotent دارد.
      if (payload.startsWith('ref_')) await attachNewReferral(env, u, payload.slice(4));
      await clearState(env, u.tg_id);
      await showMiniAppOnlyStart(env, chatId, origin);
      return;
    }
    if (text && await handleMiniAppOnlyButton(env, u, chatId, text, origin)) return;
    await msg(env, chatId, 'برای ادامه یکی از دکمه‌های پایین چت را انتخاب کنید.', mainBotReplyMarkup());
    return;
  }

  if (text === '/cancel') {
    await clearState(env, u.tg_id);
    await msg(env, chatId, '❌ عملیات لغو شد.', KB([[BTN('🏠 منوی اصلی', 'home')]]));
    return;
  }

  if (text.startsWith('/start')) {
    const parts = text.split(' ');
    const payload = parts[1] || '';
    if (payload.startsWith('agent_')) {
      const accepted = await acceptAgentInvite(env, u, payload.slice(6));
      await clearState(env, u.tg_id);
      if (accepted.ok) await msg(env, chatId, '✅ نمایندگی برای این حساب فعال شد. از Mini App بخش نمایندگی را باز کنید.');
      else await msg(env, chatId, '⚠️ لینک دعوت نمایندگی نامعتبر، منقضی یا قبلاً استفاده شده است.');
      await showHome(env, chatId, u, null, origin, !m.chat || !m.chat.type || m.chat.type === 'private');
      return;
    }
    if (payload === 'miniapp_buy') {
      await clearState(env, u.tg_id);
      await showPanels(env, chatId, null);
      return;
    }
    if (payload === 'miniapp_wallet') {
      await clearState(env, u.tg_id);
      await showWallet(env, chatId, null, u);
      return;
    }
    if (payload === 'miniapp_mysubs') {
      await clearState(env, u.tg_id);
      await showMySubs(env, chatId, null, u);
      return;
    }
    const miniBuy = payload.match(/^miniapp_buy_([A-Za-z0-9-]{1,20})_([A-Za-z0-9-]{1,20})$/);
    if (miniBuy) {
      const panels = await getPanels(env);
      const plans = await getPlans(env);
      const panel = panels[miniBuy[1]];
      const plan = plans[miniBuy[2]];
      if (isRecordEnabled(panel) && isRecordEnabled(plan) && planAssignedToPanel(plan, panel.id)) {
        await clearState(env, u.tg_id);
        await showPlanDetail(env, chatId, null, u, panel.id, plan.id, null);
        return;
      }
    }
    const miniRenew = payload.match(/^miniapp_renew_([A-Za-z0-9-]{1,20})$/);
    if (miniRenew) {
      const sub = await getSub(env, miniRenew[1]);
      if (sub && String(sub.tg_id) === String(u.tg_id)) {
        await clearState(env, u.tg_id);
        await showPlans(env, chatId, null, sub.panel_id, sub.sid);
        return;
      }
    }
    // لینک معرف: /start ref_CODE؛ فقط برای کاربر جدید و یک بار.
    if (payload.startsWith('ref_')) await attachNewReferral(env, u, payload.slice(4));
    await clearState(env, u.tg_id);
    await showHome(env, chatId, u, null, origin, !m.chat || !m.chat.type || m.chat.type === 'private');
    return;
  }

  if (text === '/admin') {
    if (!isAdmin(env, u.tg_id)) { await msg(env, chatId, '⛔ فقط ادمین!'); return; }
    await clearState(env, u.tg_id);
    await adminHome(env, chatId, null);
    return;
  }

  // عکس رسید؟
  if (m.photo && m.photo.length) {
    const fileId = m.photo[m.photo.length - 1].file_id;
    const handled = await onStatePhoto(env, u, chatId, fileId);
    if (!handled) await msg(env, chatId, 'ℹ️ برای ثبت رسید، اول از منو خرید/شارژ را شروع کنید.', KB([[BTN('🏠 منوی اصلی', 'home')]]));
    return;
  }

  if (text) {
    const handled = await onStateText(env, u, chatId, text);
    if (!handled) {
      await showHome(env, chatId, u, null, origin, !m.chat || !m.chat.type || m.chat.type === 'private');
    }
    return;
  }
}

/* ============================ آپدیت تلگرام ============================ */

async function handleUpdate(env, upd, origin) {
  const actor = upd && upd.callback_query ? upd.callback_query.from : (upd && upd.message ? upd.message.from : null);
  if (actor && actor.id != null) {
    const updateId = upd.update_id == null ? '' : String(upd.update_id);
    await recordCustomerActivity(env, actor.id, customerActivityFromUpdate(upd), {}, updateId);
  }
  if (upd.callback_query) {
    await onCallback(env, upd.callback_query, origin);
    return;
  }
  if (upd.message) {
    await onMessage(env, upd.message, origin);
    return;
  }
}

/* ============================ یادآوری انقضا (کرون) ============================ */

async function cronReminders(env) {
  const keys = await kvList(env, 's:');
  const panels = await getPanels(env);
  let checked = 0;
  for (const k of keys.slice(0, 250)) {
    const sub = await kvGet(env, k, null);
    if (!sub) continue;
    const panel = panels[sub.panel_id];
    if (!panel || panel.enabled === false) continue;
    try {
      const live = await hGetLive(panel, sub.uuid);
      const rem = planRemaining(live);
      const today = todayStr();
      if (rem.days != null && rem.days <= 3 && rem.days > 0 && sub.reminded !== today) {
        sub.reminded = today;
        await saveSub(env, sub);
        if (/^\d{1,20}$/.test(String(sub.tg_id || ''))) {
          try {
            await msg(env, sub.tg_id, '⏳ <b>یادآوری تمدید</b>\n\nاشتراک شما در سرور <b>' + esc(panel.name) + '</b> فقط <b>' + faNum(rem.days) + ' روز</b> اعتبار دارد.\nاز «اشتراک‌های من» تمدید کنید تا قطع نشوید 🙏', KB([[BTN('📦 اشتراک‌های من', 'mysubs')]]));
          } catch (e) {}
        }
      } else if ((rem.days != null && rem.days <= 0) || live.is_active === false) {
        if (!sub.expire_noticed) {
          sub.expire_noticed = true;
          await saveSub(env, sub);
          if (/^\d{1,20}$/.test(String(sub.tg_id || ''))) {
            try {
              await msg(env, sub.tg_id, '⛔ <b>اشتراک شما منقضی شد</b>\n\nسرور: ' + esc(panel.name) + '\nاز «اشتراک‌های من» آن را تمدید کنید.', KB([[BTN('📦 اشتراک‌های من', 'mysubs')]]));
            } catch (e) {}
          }
        }
      }
      checked++;
    } catch (e) { /* خطای تکی، ادامه */ }
  }
  return checked;
}

/* ====================== درگاه پیامک Shetab Verification ====================== */

function shetabJson(data, status) {
  return new Response(JSON.stringify(data), {
    status: status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

/* ========================== Mini App API ========================== */
function miniAppJson(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'Pragma': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Vary': 'X-Telegram-Init-Data'
    }
  });
}

function bytesToHex(bytes) {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}
async function hmacSha256(key, data) {
  const enc = new TextEncoder();
  const rawKey = key instanceof Uint8Array ? key : enc.encode(String(key));
  const cryptoKey = await crypto.subtle.importKey('raw', rawKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(String(data))));
}

// اعتبارسنجی server-side طبق پروتکل رسمی Telegram Mini Apps؛ initDataUnsafe هرگز مبنا نیست.
async function verifyMiniAppInitData(initData, botToken, nowSec) {
  if (!initData || initData.length > 10000 || !botToken) return null;
  let params;
  try { params = new URLSearchParams(initData); } catch (e) { return null; }
  const hash = String(params.get('hash') || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) return null;
  const pairs = [];
  const seen = new Set();
  for (const [key, value] of params.entries()) {
    if (seen.has(key)) return null;
    seen.add(key);
    if (key !== 'hash') pairs.push([key, value]);
  }
  const authDate = Number(params.get('auth_date'));
  const now = Number(nowSec || Math.floor(Date.now() / 1000));
  if (!Number.isSafeInteger(authDate) || authDate <= 0 || authDate > now + 60 || now - authDate > 86400) return null;
  pairs.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  const checkString = pairs.map((p) => p[0] + '=' + p[1]).join('\n');
  let calculated;
  try {
    // Telegram specifies HMAC-SHA256(key="WebAppData", data=bot_token).
    const secretKey = await hmacSha256('WebAppData', String(botToken));
    calculated = bytesToHex(await hmacSha256(secretKey, checkString));
  } catch (e) { return null; }
  if (!constantTimeEqual(calculated, hash)) return null;
  let user;
  try { user = JSON.parse(params.get('user') || 'null'); } catch (e) { return null; }
  const id = Number(user && user.id);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return {
    id: id,
    username: String(user.username || '').slice(0, 64),
    first_name: String(user.first_name || '').slice(0, 128),
    last_name: String(user.last_name || '').slice(0, 128),
    language_code: String(user.language_code || '').slice(0, 16)
  };
}

async function miniAppIdentity(request, env) {
  if (!env.BOT_TOKEN) return { error: 'not_configured', status: 503 };
  let initData = request.headers.get('X-Telegram-Init-Data') || '';
  if (!initData) {
    const auth = request.headers.get('Authorization') || '';
    if (/^tma\s+/i.test(auth)) initData = auth.replace(/^tma\s+/i, '');
  }
  const user = await verifyMiniAppInitData(initData, env.BOT_TOKEN);
  if (!user) return { error: 'unauthorized', status: 401 };
  return { user: user };
}

function safeBotStartLink(username, payload) {
  const name = String(username || '').replace(/^@/, '');
  if (!/^[A-Za-z0-9_]{5,32}$/.test(name)) return '';
  return 'https://t.me/' + name + '?start=' + encodeURIComponent(String(payload || ''));
}

function miniAppTypeLabel(type, upgradeFromPlanId) {
  if (type === 'renew' && upgradeFromPlanId) return 'ارتقای پلن';
  return type === 'buy' ? 'خرید جدید' : type === 'renew' ? 'تمدید' : type === 'charge' ? 'شارژ کیف پول' : '—';
}
function miniAppStatusLabel(status) {
  if (status === 'approved') return 'تکمیل‌شده';
  if (status === 'pending') return 'در انتظار';
  if (status === 'rejected') return 'ردشده';
  if (status === 'cancelled') return 'لغوشده';
  return 'نامشخص';
}
function miniAppPaymentLabel(method) {
  if (method === 'wallet') return 'کیف پول';
  if (method === 'shetab' || method === 'auto') return 'خودکار';
  if (method === 'manual') return 'دستی';
  return 'نامشخص';
}
function miniAppDayKey(ms) {
  // گزارش روزانه با منطقه زمانی تهران (UTC+03:30).
  return new Date(Number(ms) + 210 * 60 * 1000).toISOString().slice(0, 10);
}
function miniAppPeriod(value, fallback) {
  const n = Number(value);
  return [7, 30, 90].includes(n) ? n : (fallback || 30);
}

async function miniAppOrderRows(env, options) {
  const opts = options || {};
  const limit = Math.max(1, Math.min(100, Number(opts.limit) || 50));
  const indexLimit = Math.max(50, Math.min(250, Number(opts.index_limit) || 180));
  const query = String(opts.q || '').trim().toLowerCase().slice(0, 80);
  const typeFilter = String(opts.type || 'all');
  const statusFilter = String(opts.status || 'all');
  const methodFilter = String(opts.method || 'all');
  const planFilter = String(opts.plan_id || '').slice(0, 40);
  const panelFilter = String(opts.panel_id || '').slice(0, 40);
  const days = Number(opts.days) === 0 ? 0 : miniAppPeriod(opts.days, 30);
  const from = days ? Date.now() - days * 86400000 : 0;
  const [orderIndex, saleIndex, plans, panels] = await Promise.all([
    listIndexedValues(env, 'order_idx:', indexLimit),
    listIndexedValues(env, 'ledger_idx:sale:', indexLimit),
    getPlans(env), getPanels(env)
  ]);
  const rawOrders = await Promise.all(orderIndex.items.map((x) => x && x.id ? getOrder(env, x.id) : null));
  const byId = new Map();
  for (const o of rawOrders) if (o && o.id) byId.set(String(o.id), {
    id: String(o.id), tg_id: String(o.tg_id || ''), username: String(o.username || ''),
    first_name: String(o.first_name || ''), type: String(o.type || ''), plan_id: o.plan_id || '',
    upgrade_from_plan_id: String(o.upgrade_from_plan_id || ''), panel_id: o.panel_id || '', amount: Number(o.amount || 0), payment_method: String(o.payment_method || 'unknown'),
    status: String(o.status || 'pending'), payment_status: String(o.payment_status || ''),
    pay_amount: o.pay_amount == null ? null : Number(o.pay_amount), receipt_submitted: !!o.receipt_submitted_at,
    created_at: Number(o.created_at || 0), updated_at: Number(o.updated_at || 0),
    order_id: String(o.id), sub_sid: o.sub_sid || '', mutable: true
  });
  for (const row of saleIndex.items) {
    if (!row || row.kind !== 'sale') continue;
    const key = row.order_id ? String(row.order_id) : 'ledger:' + String(row.id);
    if (row.order_id && byId.has(String(row.order_id))) continue;
    if (byId.has(key)) continue;
    byId.set(key, {
      id: String(row.order_id || row.id), tg_id: String(row.tg_id || ''), username: String(row.username || ''),
      first_name: String(row.first_name || ''), type: String(row.type || ''), plan_id: row.plan_id || '',
      upgrade_from_plan_id: String(row.upgrade_from_plan_id || ''), panel_id: row.panel_id || '', amount: Number(row.amount || 0), payment_method: String(row.payment_method || 'unknown'),
      status: 'approved', created_at: Number(row.occurred_at || row.created_at || 0),
      updated_at: Number(row.occurred_at || row.created_at || 0), order_id: row.order_id || '', sub_sid: row.sub_sid || '', mutable: false
    });
  }
  const candidates = Array.from(byId.values()).map((o) => {
    const plan = plans[o.plan_id] || null;
    const panel = panels[o.panel_id] || null;
    return Object.assign({}, o, {
      plan_name: plan ? String(plan.title || '') : '',
      panel_name: panel ? String(panel.name || '') : '',
      type_label: miniAppTypeLabel(o.type, o.upgrade_from_plan_id), upgrade_from_plan_id: o.upgrade_from_plan_id || '', status_label: miniAppStatusLabel(o.status),
      payment_label: miniAppPaymentLabel(o.payment_method),
      state: o.status === 'approved' ? 'paid' : o.status === 'pending' ? 'pending' : 'failed'
    });
  }).filter((o) => {
    if (from && o.created_at < from) return false;
    if (typeFilter !== 'all' && o.type !== typeFilter) return false;
    if (statusFilter !== 'all' && o.status !== statusFilter) return false;
    if (methodFilter === 'auto' && !['auto', 'shetab'].includes(o.payment_method)) return false;
    if (methodFilter !== 'all' && methodFilter !== 'auto' && o.payment_method !== methodFilter) return false;
    if (planFilter && String(o.plan_id) !== planFilter) return false;
    if (panelFilter && String(o.panel_id) !== panelFilter) return false;
    if (!query) return true;
    const haystack = [o.id, o.order_id, o.tg_id, o.username, o.first_name, o.type_label, o.plan_name, o.panel_name].join(' ').toLowerCase();
    return haystack.includes(query);
  }).sort((a, b) => b.created_at - a.created_at);
  const selected = candidates.slice(0, limit);
  const userIds = Array.from(new Set(selected.map((o) => String(o.tg_id)).filter(Boolean)));
  const users = new Map(await Promise.all(userIds.map(async (id) => [id, await getUser(env, id)])));
  const items = selected.map((o) => {
    const u = users.get(String(o.tg_id)) || null;
    const name = o.first_name || (u && u.first_name) || o.username || (u && u.username) || ('کاربر ' + o.tg_id);
    const username = o.username || (u && u.username) || '';
    return {
      id: o.id, tg_id: String(o.tg_id), name: name,
      username: username, tg: username ? '@' + username : String(o.tg_id),
      type: o.type, type_label: o.type_label, plan: [o.plan_name, o.panel_name].filter(Boolean).join(' · ') || '—',
      plan_id: o.plan_id, panel_id: o.panel_id, method: o.payment_label,
      amount: o.amount, pay_amount: o.pay_amount, payment_status: o.payment_status || '',
      receipt_submitted: !!o.receipt_submitted, mutable: !!o.mutable,
      status: o.status, status_label: o.status_label, state: o.state,
      created_at: o.created_at, order_id: o.order_id || null
    };
  });
  return {
    items: items,
    truncated: !!(orderIndex.has_more || saleIndex.has_more),
    search_window: indexLimit,
    matched: candidates.length
  };
}

async function miniAppAdminSummary(env, days) {
  const now = Date.now();
  const periodMs = days * 86400000;
  const from = now - periodMs;
  const previousFrom = now - periodMs * 2;
  const [saleIndex, topupIndex, usersCount, subsCount, userIndex, cfg, plans, panels, pendingIds] = await Promise.all([
    listIndexedValues(env, 'ledger_idx:sale:', 500),
    listIndexedValues(env, 'ledger_idx:wallet_topup:', 75),
    countPrefixBounded(env, 'u:', 10),
    countPrefixBounded(env, 's:', 10),
    listIndexedValues(env, 'user_idx:', 100),
    getCfg(env), getPlans(env), getPanels(env), kvGet(env, 'pend', [])
  ]);
  const sales = saleIndex.items.filter((r) => r && r.kind === 'sale' && (r.type === 'buy' || r.type === 'renew'));
  const inCompareWindow = sales.filter((r) => Number(r.occurred_at || r.created_at || 0) >= previousFrom && Number(r.occurred_at || r.created_at || 0) <= now);
  const current = inCompareWindow.filter((r) => Number(r.occurred_at || r.created_at || 0) >= from);
  const previous = inCompareWindow.filter((r) => Number(r.occurred_at || r.created_at || 0) < from);
  const sum = (rows) => rows.reduce((acc, row) => acc + Number(row.amount || 0), 0);
  const delta = (a, b) => b > 0 ? Math.round(((a - b) / b) * 1000) / 10 : null;
  const payment = { wallet: 0, auto: 0, manual: 0, other: 0 };
  const paymentCount = { wallet: 0, auto: 0, manual: 0, other: 0 };
  const byPlan = new Map();
  const byServer = new Map();
  const byType = { buy: 0, renew: 0 };
  for (const row of current) {
    const amount = Number(row.amount || 0);
    const method = row.payment_method === 'wallet' ? 'wallet' : (row.payment_method === 'shetab' || row.payment_method === 'auto') ? 'auto' : row.payment_method === 'manual' ? 'manual' : 'other';
    payment[method] += amount; paymentCount[method]++;
    byType[row.type] = (byType[row.type] || 0) + 1;
    const planId = String(row.plan_id || 'unknown');
    const plan = plans[planId] || {};
    const planEntry = byPlan.get(planId) || { id: planId, title: String(plan.title || 'پلن حذف‌شده'), count: 0, revenue: 0, buy_count: 0, renew_count: 0 };
    planEntry.count++; planEntry.revenue += amount;
    if (row.type === 'buy') planEntry.buy_count++; else planEntry.renew_count++;
    byPlan.set(planId, planEntry);
    const panelId = String(row.panel_id || 'unknown');
    const panel = panels[panelId] || {};
    const serverEntry = byServer.get(panelId) || { id: panelId, name: String(panel.name || 'سرور حذف‌شده'), count: 0, revenue: 0 };
    serverEntry.count++; serverEntry.revenue += amount; byServer.set(panelId, serverEntry);
  }
  const chartMap = new Map();
  for (let i = days - 1; i >= 0; i--) {
    const date = miniAppDayKey(now - i * 86400000);
    chartMap.set(date, { date: date, revenue: 0, orders: 0, buy: 0, renew: 0 });
  }
  for (const row of current) {
    const bucket = chartMap.get(miniAppDayKey(Number(row.occurred_at || row.created_at || 0)));
    if (!bucket) continue;
    bucket.revenue += Number(row.amount || 0); bucket.orders++;
    if (row.type === 'buy') bucket.buy++; else bucket.renew++;
  }
  const topups = topupIndex.items.filter((r) => r && Number(r.occurred_at || r.created_at || 0) >= from && Number(r.occurred_at || r.created_at || 0) <= now);
  const partial = saleIndex.has_more && sales.length >= saleIndex.key_count && sales.length > 0 &&
    Number(sales[sales.length - 1].occurred_at || sales[sales.length - 1].created_at || 0) >= previousFrom;
  const latestUsers = userIndex.items.filter((u) => Number(u.joined_at || 0) >= from && Number(u.joined_at || 0) <= now).length;
  const recentResult = await miniAppOrderRows(env, { limit: 8, index_limit: 40, days: 0 });
  const pending = [];
  for (const id of (pendingIds || []).slice(-8).reverse()) {
    const o = await getOrder(env, id);
    if (o && o.status === 'pending') pending.push(o);
  }
  // سفارش‌های معلق را در ردیف‌های اخیر هم نشان بده؛ دادهٔ رسید/شماره کارت هیچ‌وقت به API نمی‌رود.
  const recentOrders = recentResult.items.slice(0, 8);
  for (const o of pending) {
    recentOrders.unshift({
      id: String(o.id), tg_id: String(o.tg_id), name: String(o.first_name || o.username || ('کاربر ' + o.tg_id)),
      username: String(o.username || ''), tg: o.username ? '@' + o.username : String(o.tg_id),
      type: o.type, type_label: miniAppTypeLabel(o.type, o.upgrade_from_plan_id), plan: [plans[o.plan_id] && plans[o.plan_id].title, panels[o.panel_id] && panels[o.panel_id].name].filter(Boolean).join(' · ') || (o.type === 'charge' ? 'شارژ کیف پول' : '—'),
      method: miniAppPaymentLabel(o.payment_method), amount: Number(o.amount || 0), status: 'pending', status_label: 'در انتظار', state: 'pending', created_at: Number(o.created_at || 0), order_id: String(o.id)
    });
  }
  recentOrders.sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0));
  return {
    ok: true, period_days: days,
    totals: {
      revenue: sum(current), sales: current.length, new_sales: byType.buy, renewals: byType.renew,
      pending_orders: (pendingIds || []).length,
      users: usersCount.count, users_count_partial: usersCount.partial,
      subscriptions_recorded: subsCount.count, subscriptions_count_partial: subsCount.partial,
      new_customers: latestUsers, wallet_topups: topups.length,
      wallet_topups_amount: sum(topups), previous_revenue: sum(previous), previous_sales: previous.length,
      revenue_change_pct: delta(sum(current), sum(previous)), sales_change_pct: delta(current.length, previous.length)
    },
    payments: Object.keys(payment).map((key) => ({ key: key, amount: payment[key], count: paymentCount[key] })),
    chart: Array.from(chartMap.values()),
    top_plans: Array.from(byPlan.values()).sort((a,b) => b.count - a.count).slice(0, 6),
    top_servers: Array.from(byServer.values()).sort((a,b) => b.count - a.count).slice(0, 5),
    recent_orders: recentOrders.slice(0, 10),
    coverage: {
      indexed_sale_rows: sales.length,
      partial: partial,
      since: sales.length ? new Date(Math.min(...sales.map((r) => Number(r.occurred_at || r.created_at || now)))).toISOString() : null,
      note: 'گزارش از رویدادهای دفتر فروشِ ایندکس‌شده پس از انتشار این نسخه ساخته می‌شود؛ سوابق قدیمیِ ناقص بازسازی نمی‌شوند.'
    }
  };
}

async function miniAppAdminCustomers(env, query, limit) {
  const q = String(query || '').trim().toLowerCase().slice(0, 80);
  const max = Math.max(1, Math.min(100, Number(limit) || 50));
  let candidates = [];
  if (/^\d{1,20}$/.test(q)) {
    const user = await getUser(env, q);
    if (user) candidates = [user];
  } else {
    const index = await listIndexedValues(env, 'user_idx:', 200);
    const ids = index.items.map((r) => r && r.tg_id).filter(Boolean);
    candidates = await Promise.all(ids.map((id) => getUser(env, id)));
    candidates = candidates.filter(Boolean);
    if (q) candidates = candidates.filter((u) => [u.tg_id, u.username, u.first_name].join(' ').toLowerCase().includes(q));
  }
  const count = await countPrefixBounded(env, 'u:', 10);
  const items = candidates.sort((a,b) => Number(b.joined_at || 0) - Number(a.joined_at || 0)).slice(0, max).map((u) => ({
    tg_id: String(u.tg_id), first_name: String(u.first_name || ''), username: String(u.username || ''),
    balance: Number(u.balance || 0), total_spent: Number(u.total_spent || 0),
    invited: Number(u.invited || 0), subscriptions: Array.isArray(u.subs) ? u.subs.length : 0,
    banned: !!u.banned, joined_at: Number(u.joined_at || 0), last_activity_at: Number(u.last_activity_at || u.joined_at || 0)
  }));
  return { ok: true, items: items, registered_users: count.count, count_partial: count.partial, search_window: 200, note: 'فهرست متنی از کاربران ایندکس‌شده است؛ جست‌وجوی آیدی عددی مستقیماً در KV انجام می‌شود.' };
}

async function miniAppAdminCustomerDetail(env, tgid) {
  const id = String(tgid || '').replace(/[^0-9]/g, '').slice(0, 20);
  const user = id ? await getUser(env, id) : null;
  if (!user) return { ok: false, error: 'customer_not_found' };
  const [panels, plans, orderIndex, ledgerIndex, activityIndex, withdrawalIndex, referrer] = await Promise.all([
    getPanels(env), getPlans(env),
    listIndexedValues(env, 'user_order_idx:' + id + ':', 150),
    listIndexedValues(env, 'user_ledger_idx:' + id + ':', 150),
    listIndexedValues(env, 'user_activity_idx:' + id + ':', 100),
    listIndexedValues(env, 'user_withdraw_idx:' + id + ':', 100),
    user.referred_by ? getUser(env, user.referred_by) : Promise.resolve(null)
  ]);
  const orders = [];
  const orderIds = new Set();
  for (const idx of orderIndex.items) {
    const fromLedger = idx && idx.source === 'ledger';
    const rowId = String(idx && idx.id || '');
    if (!rowId) continue;
    const row = fromLedger ? await kvGet(env, 'ledger:sale:' + rowId, null) : await getOrder(env, rowId);
    if (!row || String(row.tg_id) !== id) continue;
    const plan = plans[String(row.plan_id)] || {};
    const panel = panels[String(row.panel_id)] || {};
    const status = fromLedger ? 'approved' : String(row.status || 'unknown');
    const createdAt = Number(row.occurred_at || row.created_at || idx.created_at || 0);
    const orderItem = {
      id: String(row.order_id || row.id || rowId), order_id: String(row.order_id || row.id || rowId),
      type: String(row.type || (row.kind === 'wallet_topup' ? 'charge' : 'sale')),
      type_label: miniAppTypeLabel(row.type || (row.kind === 'wallet_topup' ? 'charge' : 'sale'), row.upgrade_from_plan_id),
      plan: [String(plan.title || row.plan_name || ''), String(panel.name || row.panel_name || '')].filter(Boolean).join(' · ') || (row.type === 'charge' ? 'شارژ کیف پول' : '—'),
      panel_name: String(panel.name || row.panel_name || ''), plan_name: String(plan.title || row.plan_name || ''),
      amount: Number(row.amount || 0), pay_amount: row.pay_amount == null ? null : Number(row.pay_amount),
      payment_method: String(row.payment_method || ''), method: miniAppPaymentLabel(row.payment_method),
      payment_status: String(row.payment_status || ''), status: status, status_label: miniAppStatusLabel(status),
      receipt_submitted: !!row.receipt_submitted_at, receipt_text: String(row.receipt_text || '').slice(0, 300),
      payment_ref: String(row.payment_ref || '').slice(0, 100), admin_note: String(row.admin_note || '').slice(0, 300),
      reject_reason: String(row.reject_reason || '').slice(0, 300), created_at: createdAt,
      updated_at: Number(row.updated_at || createdAt), sub_sid: String(row.sub_sid || ''), source: fromLedger ? 'ledger' : 'order'
    };
    orders.push(orderItem);
    orderIds.add(String(orderItem.order_id));
  }
  orders.sort((a,b) => b.created_at - a.created_at);

  const transactions = [];
  const transactionKeys = new Set();
  for (const order of orders) {
    const key = 'order:' + String(order.order_id);
    if (transactionKeys.has(key)) continue;
    transactionKeys.add(key);
    transactions.push({
      id: order.order_id, kind: order.type === 'charge' ? 'wallet_topup' : 'sale',
      label: order.type_label, description: order.plan, amount: order.amount,
      direction: order.type === 'charge' ? 'in' : 'out', method: order.method,
      status: order.status, status_label: order.status_label, created_at: order.created_at,
      order_id: order.order_id, payment_ref: order.payment_ref
    });
  }
  for (const idx of ledgerIndex.items) {
    const row = idx && idx.id ? await kvGet(env, 'ledger:' + String(idx.kind || 'sale') + ':' + String(idx.id), null) : null;
    if (!row || String(row.tg_id) !== id) continue;
    const kind = String(row.kind || idx.kind || 'ledger');
    const linkedOrderId = String(row.order_id || row.id || '');
    if (linkedOrderId && orderIds.has(linkedOrderId) && (kind === 'sale' || kind === 'wallet_topup')) continue;
    const key = 'ledger:' + kind + ':' + String(row.id || idx.id);
    if (transactionKeys.has(key)) continue;
    transactionKeys.add(key);
    const type = String(row.type || '');
    const label = kind === 'wallet_adjustment' ? (type === 'admin_debit' ? 'کسر دستی کیف پول' : 'افزایش دستی کیف پول') :
      kind === 'wallet_topup' ? 'شارژ کیف پول' : kind === 'withdrawal' ? 'برداشت کیف پول' : kind === 'sale' ? miniAppTypeLabel(type, row.upgrade_from_plan_id) : 'تراکنش کیف پول';
    transactions.push({
      id: String(row.id || idx.id), kind: kind, label: label,
      description: kind === 'wallet_adjustment' ? 'توسط مدیر ' + String(row.actor_id || '—') : String(row.description || ''),
      amount: Number(row.amount || 0), direction: (kind === 'wallet_adjustment' && type === 'admin_debit') || kind === 'sale' ? 'out' : 'in',
      method: miniAppPaymentLabel(row.payment_method), status: String(row.status || 'recorded'),
      status_label: String(row.status || 'ثبت‌شده'), created_at: Number(row.occurred_at || row.created_at || idx.occurred_at || 0),
      order_id: String(row.order_id || ''), payment_ref: String(row.payment_ref || '')
    });
  }
  for (const idx of withdrawalIndex.items) {
    const w = idx && idx.id ? await getWithdraw(env, idx.id) : null;
    if (!w || String(w.tg_id) !== id) continue;
    const key = 'withdrawal:' + String(w.id);
    if (transactionKeys.has(key)) continue;
    transactionKeys.add(key);
    transactions.push({
      id: String(w.id), kind: 'withdrawal', label: w.status === 'approved' ? 'برداشت پرداخت‌شده' : w.status === 'rejected' ? 'برداشت ردشده' : 'درخواست برداشت',
      description: 'کارت مقصد •••• ' + String(w.card || '').replace(/\D/g, '').slice(-4), amount: Number(w.amount || 0),
      direction: w.status === 'rejected' ? 'in' : 'out', method: 'برداشت دستی',
      status: String(w.status || 'unknown'), status_label: miniAppStatusLabel(w.status),
      created_at: Number(w.created_at || idx.created_at || 0), order_id: '', payment_ref: ''
    });
  }
  transactions.sort((a,b) => b.created_at - a.created_at);

  const subscriptions = [];
  const subIds = Array.from(new Set(Array.isArray(user.subs) ? user.subs.map(String) : [])).slice(-40).reverse();
  for (const sid of subIds) {
    const sub = await getSub(env, sid);
    if (!sub || String(sub.tg_id) !== id) continue;
    const panel = panels[String(sub.panel_id)] || {};
    const plan = plans[String(sub.plan_id)] || {};
    let live = null;
    if (panel && panel.api_base && sub.uuid) { try { live = await hGetLive(panel, sub.uuid); } catch (e) {} }
    const rem = planRemaining(live || {});
    const active = !!live && live.is_active !== false && live.enable !== false;
    const total = Number(live && live.usage_limit_GB != null ? live.usage_limit_GB : plan.gb || 0);
    const used = Number(live && live.current_usage_GB || 0);
    subscriptions.push({
      sid: String(sub.sid), plan_name: String(plan.title || 'پلن حذف‌شده'), panel_name: String(panel.name || 'سرور حذف‌شده'),
      status: !live ? 'unknown' : active ? 'active' : 'inactive',
      status_label: !live ? 'وضعیت زنده نامشخص' : active ? 'فعال' : 'غیرفعال/منقضی',
      usage_used: Number.isFinite(used) ? used : 0, usage_total: Number.isFinite(total) ? total : 0,
      usage_unlimited: total === 0 || total >= 100000,
      days_remaining: rem.days == null ? null : rem.days, expires_at: rem.expiry ? rem.expiry.toISOString() : null,
      created_at: Number(sub.created_at || 0), order_id: String(sub.order_id || '')
    });
  }
  const activity = activityIndex.items.map((event) => ({
    at: Number(event.at || 0), action: String(event.action || 'telegram_interaction'),
    order_id: String(event.order_id || ''), amount: event.amount == null ? null : Number(event.amount),
    kind: String(event.kind || ''), actor_id: String(event.actor_id || '')
  }));
  const latestPurchase = orders.find((o) => (o.type === 'buy' || o.type === 'renew') && o.status === 'approved') || null;
  const latestActivity = Math.max(Number(user.last_activity_at || user.joined_at || 0), Number(activity[0] && activity[0].at || 0));
  const customer = {
    tg_id: String(user.tg_id), first_name: String(user.first_name || ''), username: String(user.username || ''),
    joined_at: Number(user.joined_at || 0), last_activity_at: latestActivity,
    balance: Number(user.balance || 0), total_spent: Number(user.total_spent || 0),
    earned: Number(user.earned || 0), invited: Number(user.invited || 0),
    referred_by: user.referred_by == null ? '' : String(user.referred_by),
    referrer_name: referrer ? String(referrer.first_name || referrer.username || referrer.tg_id) : '',
    first_paid: !!user.first_paid, banned: !!user.banned,
    subscriptions: subscriptions.length, registered_subscriptions: Array.isArray(user.subs) ? user.subs.length : 0
  };
  return {
    ok: true, customer: customer, summary: {
      orders: orders.length, transactions: transactions.length, activity_events: activity.length,
      pending_orders: orders.filter((o) => o.status === 'pending').length,
      completed_orders: orders.filter((o) => o.status === 'approved').length,
      last_purchase: latestPurchase
    }, orders: orders, transactions: transactions.slice(0, 100), subscriptions: subscriptions,
    activity: activity, coverage: {
      orders_partial: orderIndex.has_more, transactions_partial: ledgerIndex.has_more || withdrawalIndex.has_more,
      activity_partial: activityIndex.has_more, activity_retention_days: CUSTOMER_ACTIVITY_TTL / 86400,
      note: 'تاریخچهٔ رویدادهای ربات از انتشار نسخهٔ جدید جمع‌آوری می‌شود؛ محتوای پیام‌ها ذخیره نمی‌شود و پیام‌های گذشته قابل بازیابی نیستند.'
    }
  };
}

async function miniAppAdminPlans(env, days) {
  const from = Date.now() - days * 86400000;
  const [plans, panels, saleIndex] = await Promise.all([
    getPlans(env), getPanels(env), listIndexedValues(env, 'ledger_idx:sale:', 500)
  ]);
  const rows = saleIndex.items.filter((r) => r && r.kind === 'sale' && Number(r.occurred_at || r.created_at || 0) >= from && (r.type === 'buy' || r.type === 'renew'));
  const stat = new Map();
  const serverStat = new Map();
  const typeTotals = { buy_count: 0, renew_count: 0, buy_revenue: 0, renew_revenue: 0 };
  for (const row of rows) {
    const key = String(row.plan_id || 'unknown');
    const item = stat.get(key) || { count: 0, buy_count: 0, renew_count: 0, revenue: 0 };
    item.count++; item.revenue += Number(row.amount || 0);
    if (row.type === 'buy') { item.buy_count++; typeTotals.buy_count++; typeTotals.buy_revenue += Number(row.amount || 0); }
    else { item.renew_count++; typeTotals.renew_count++; typeTotals.renew_revenue += Number(row.amount || 0); }
    stat.set(key, item);
    const serverId = String(row.panel_id || 'unknown');
    const panel = panels[serverId] || {};
    const server = serverStat.get(serverId) || { id: serverId, name: String(panel.name || 'سرور حذف‌شده'), count: 0, revenue: 0 };
    server.count++; server.revenue += Number(row.amount || 0); serverStat.set(serverId, server);
  }
  const items = Object.values(plans || {}).map((p) => {
    const s = stat.get(String(p.id)) || { count: 0, buy_count: 0, renew_count: 0, revenue: 0 };
    return {
      id: String(p.id), title: String(p.title || ''), gb: Number(p.gb || 0), days: Number(p.days || 0),
      price: Number(p.price || 0), enabled: p.enabled !== false,
      servers: Object.values(panels).filter((x) => x && x.enabled !== false && planAssignedToPanel(p, x.id)).map((x) => String(x.name || '')),
      count: s.count, buy_count: s.buy_count, renew_count: s.renew_count, revenue: s.revenue
    };
  }).sort((a,b) => b.count - a.count || a.price - b.price);
  return { ok: true, period_days: days, items: items, top_servers: Array.from(serverStat.values()).sort((a,b) => b.count - a.count).slice(0, 5), type_totals: typeTotals, coverage_partial: saleIndex.has_more };
}

async function ensureReferralCode(env, user) {
  const current = await getUser(env, user && user.tg_id) || user;
  if (!current) return null;
  let code = String(current.ref_code || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  if (!code) code = uid(8);
  const mapped = await kvGet(env, 'ref:' + code, null);
  if (mapped && String(mapped) !== String(current.tg_id)) code = uid(8);
  if (String(current.ref_code || '') !== code) { current.ref_code = code; await saveUser(env, current); }
  await kvPut(env, 'ref:' + code, current.tg_id);
  return current;
}

async function miniAppReferralSummary(env, user, cfg, panels) {
  const current = await ensureReferralCode(env, user);
  if (!current) return { user: user, summary: { invite_link: '', joined_count: 0, points_balance: 0, purchase_count: 0, free_rewards_available: 0 } };
  const botUsername = await ensureBotUsername(env, cfg || await getCfg(env));
  const botName = String(botUsername || '').replace(/^@/, '');
  const state = referralInviteState(current);
  const points = Math.max(0, Math.floor(Number(current.referral_points_balance || 0)));
  const rewardPanel = panels && panels[String(cfg && cfg.free_subscription_panel_id || '')];
  const rewardPanelReady = !!(rewardPanel && isRecordEnabled(rewardPanel) && rewardPanel.api_base && rewardPanel.api_key && rewardPanel.user_base);
  return {
    user: current,
    summary: {
      referral_code: String(current.ref_code || ''),
      invite_link: botName ? 'https://t.me/' + botName + '?start=ref_' + String(current.ref_code || '') : '',
      bot_username: botName,
      joined_count: state.joined,
      points_balance: points,
      points_earned_total: Math.max(0, Math.floor(Number(current.referral_points_earned_total || 0))),
      points_redeemed_total: Math.max(0, Math.floor(Number(current.referral_points_redeemed_total || 0))),
      wallet_credited_total: Math.max(0, Math.floor(Number(current.referral_wallet_credited_total || 0))),
      purchase_count: Math.max(0, Math.floor(Number(current.referral_purchase_count || 0))),
      referral_commission_percent: Math.max(0, Number(cfg && cfg.commission || 0)),
      next_reward_progress: state.available > 0 ? 3 : state.progress,
      free_rewards_available: state.available,
      free_rewards_claimed: state.claimed,
      free_rewards_earned: state.earned,
      free_reward_ready: state.available > 0 && rewardPanelReady,
      free_reward_panel_ready: rewardPanelReady,
      free_reward_gb: 3,
      free_reward_days: 3,
      points_redeemable: Math.floor(points / 100) * 200000,
      points_needed_for_redemption: points >= 100 ? 0 : 100 - points,
      redeem_rule: { points: 100, toman: 200000 }
    }
  };
}

async function miniAppCustomerData(env, user) {
  const tgId = String(user.tg_id);
  const [cfg, panels, plans, orderIndex, ledgerIndex, withdrawalIndex] = await Promise.all([
    getCfg(env), getPanels(env), getPlans(env),
    listIndexedValues(env, 'user_order_idx:' + tgId + ':', 100),
    listIndexedValues(env, 'user_ledger_idx:' + tgId + ':', 120),
    listIndexedValues(env, 'user_withdraw_idx:' + tgId + ':', 100)
  ]);
  const referralInfo = await miniAppReferralSummary(env, user, cfg, panels);
  user = referralInfo.user || user;
  // Keep the live Hiddify fan-out bounded while including more than the old ten-subscription cap.
  const allSubIds = Array.from(new Set(Array.isArray(user.subs) ? user.subs.map(String) : []));
  const subIds = allSubIds.slice(-25).reverse();
  const subscriptions = await Promise.all(subIds.map(async (sid) => {
    const sub = await getSub(env, sid);
    if (!sub || String(sub.tg_id) !== tgId) return null;
    const panel = panels[String(sub.panel_id || '')] || null;
    const plan = plans[String(sub.plan_id || '')] || null;
    let live = null;
    if (panel && panel.api_base && sub.uuid) { try { live = await hGetLive(panel, sub.uuid); } catch (e) {} }
    const fallbackGb = plan ? Number(plan.gb) : Number(sub.free_gb || 0);
    const total = live && live.usage_limit_GB != null ? Number(live.usage_limit_GB) : fallbackGb;
    const used = live && live.current_usage_GB != null ? Number(live.current_usage_GB) : 0;
    const remaining = planRemaining(live || {});
    let safeLink = '';
    if (panel && panel.user_base && sub.uuid) {
      try { const parsed = new URL(userLink(panel, sub.uuid)); if (parsed.protocol === 'https:') safeLink = parsed.toString(); } catch (e) {}
    }
    return {
      sid: String(sub.sid || sid), panel_id: String(sub.panel_id || ''), plan_id: String(sub.plan_id || ''),
      panel_name: String(panel ? panel.name || '' : 'سرور حذف‌شده'), plan_name: String(plan ? plan.title : (sub.plan_name || (isFreeSubscription(sub) ? 'اشتراک رایگان' : 'پلن حذف‌شده'))),
      is_free: isFreeSubscription(sub),
      status: !live ? 'unknown' : (live.is_active !== false && live.enable !== false ? 'active' : 'expired'),
      status_label: !live ? (panel ? 'وضعیت نامشخص' : 'پنل حذف‌شده') : (live.is_active !== false && live.enable !== false ? 'فعال' : 'منقضی/غیرفعال'),
      usage_used: Number.isFinite(used) ? used : 0,
      usage_total: Number.isFinite(total) ? total : 0,
      usage_unlimited: total === 0 || total >= 100000,
      usage_remaining: total === 0 || total >= 100000 ? null : Math.max(0, total - used),
      days_remaining: remaining.days == null ? null : remaining.days,
      expires_at: remaining.expiry ? remaining.expiry.toISOString() : null,
      created_at: Number(sub.created_at || 0), link: safeLink
    };
  }));
  const orderRows = await Promise.all(orderIndex.items.map(async (idx) => {
    const isLedger = idx && idx.source === 'ledger';
    const rowId = String(idx && idx.id || '');
    if (!rowId) return null;
    const o = isLedger ? await kvGet(env, 'ledger:sale:' + rowId, null) : await getOrder(env, rowId);
    if (!o || String(o.tg_id) !== tgId) return null;
    const plan = plans[String(o.plan_id)] || {};
    const panel = panels[String(o.panel_id)] || {};
    const fallbackPlan = String(o.plan_name || '');
    const fallbackPanel = String(o.panel_name || '');
    const status = isLedger ? 'approved' : String(o.status || 'unknown');
    const type = String(o.type || (o.kind === 'wallet_topup' ? 'charge' : ''));
    return {
      id: String(o.id || rowId), order_id: String(o.order_id || (isLedger ? '' : o.id || rowId)),
      source: isLedger ? 'ledger' : 'order', kind: String(o.kind || (type === 'charge' ? 'wallet_topup' : 'sale')),
      type: type, type_label: miniAppTypeLabel(type, o.upgrade_from_plan_id), upgrade_from_plan_id: String(o.upgrade_from_plan_id || ''),
      plan: [String(plan.title || fallbackPlan), String(panel.name || fallbackPanel)].filter(Boolean).join(' · ') || (type === 'charge' ? 'شارژ کیف پول' : '—'),
      amount: Number(o.amount || 0), pay_amount: o.pay_amount == null ? null : Number(o.pay_amount),
      method: miniAppPaymentLabel(o.payment_method), payment_method: String(o.payment_method || ''),
      payment_status: String(o.payment_status || ''), receipt_submitted: !!o.receipt_submitted_at,
      status: status, status_label: miniAppStatusLabel(status),
      created_at: Number(o.occurred_at || o.created_at || idx.created_at || 0)
    };
  }));
  const validOrderRows = orderRows.filter(Boolean).sort((a,b) => b.created_at - a.created_at);
  const orders = validOrderRows.slice(0, 50);
  const transactions = [];
  const transactionKeys = new Set();
  for (const row of validOrderRows) {
    const key = row.source === 'ledger' ? 'ledger:' + row.kind + ':' + row.id : 'order:' + row.id;
    if (transactionKeys.has(key)) continue;
    transactionKeys.add(key);
    transactions.push({
      id: row.id, kind: row.kind, label: row.type_label, description: row.plan,
      amount: row.amount, direction: row.type === 'charge' ? 'in' : 'out', method: row.method,
      status: row.status, status_label: row.status_label, created_at: row.created_at,
      order_id: row.order_id || (row.source === 'order' ? row.id : '')
    });
  }
  for (const idx of ledgerIndex.items) {
    if (!idx || !idx.id) continue;
    const kind = String(idx.kind || 'sale');
    const row = await kvGet(env, 'ledger:' + kind + ':' + String(idx.id), null);
    if (!row || String(row.tg_id) !== tgId) continue;
    if (row.order_id && transactionKeys.has('order:' + String(row.order_id)) && (kind === 'sale' || kind === 'wallet_topup')) continue;
    const key = 'ledger:' + kind + ':' + String(row.id || idx.id);
    if (transactionKeys.has(key)) continue;
    transactionKeys.add(key);
    const type = String(row.type || '');
    const label = kind === 'wallet_adjustment' ? (type === 'referral_points' ? 'تبدیل امتیاز عضوگیری' : type === 'admin_debit' ? 'کسر دستی کیف پول' : 'افزایش دستی کیف پول') :
      kind === 'wallet_topup' ? 'شارژ کیف پول' : kind === 'withdrawal' ? 'برداشت کیف پول' : kind === 'sale' ? miniAppTypeLabel(type, row.upgrade_from_plan_id) : 'تراکنش کیف پول';
    transactions.push({
      id: String(row.id || idx.id), kind: kind, label: label,
      description: kind === 'wallet_adjustment' ? (type === 'referral_points' ? String(row.description || 'تبدیل امتیاز عضوگیری') : 'توسط مدیر') : String(row.description || ''),
      amount: Number(row.amount || 0), direction: (kind === 'wallet_adjustment' && type === 'admin_debit') || kind === 'sale' ? 'out' : 'in',
      method: miniAppPaymentLabel(row.payment_method), status: String(row.status || 'recorded'),
      status_label: row.status ? miniAppStatusLabel(row.status) : 'ثبت‌شده',
      created_at: Number(row.occurred_at || row.created_at || idx.occurred_at || 0), order_id: String(row.order_id || '')
    });
  }
  for (const idx of withdrawalIndex.items) {
    const withdrawal = idx && idx.id ? await getWithdraw(env, idx.id) : null;
    if (!withdrawal || String(withdrawal.tg_id) !== tgId) continue;
    const key = 'withdrawal:' + String(withdrawal.id);
    if (transactionKeys.has(key)) continue;
    transactionKeys.add(key);
    const status = String(withdrawal.status || 'unknown');
    transactions.push({
      id: String(withdrawal.id), kind: 'withdrawal',
      label: status === 'approved' ? 'برداشت پرداخت‌شده' : status === 'rejected' ? 'برداشت ردشده' : 'درخواست برداشت',
      description: 'کارت مقصد •••• ' + String(withdrawal.card || '').replace(/\D/g, '').slice(-4),
      amount: Number(withdrawal.amount || 0), direction: status === 'rejected' ? 'in' : 'out', method: 'برداشت دستی',
      status: status, status_label: miniAppStatusLabel(status),
      created_at: Number(withdrawal.created_at || idx.created_at || 0), order_id: ''
    });
  }
  transactions.sort((a,b) => b.created_at - a.created_at);
  const pendingOrders = [];
  const rawPendingIds = await kvGet(env, 'pend', []);
  const pendingIds = Array.isArray(rawPendingIds) ? rawPendingIds : [];
  for (const id of pendingIds.slice(-150).reverse()) {
    const o = await getOrder(env, id);
    if (!o || o.status !== 'pending' || String(o.tg_id) !== tgId) continue;
    const plan = plans[String(o.plan_id)] || {};
    const panel = panels[String(o.panel_id)] || {};
    pendingOrders.push({
      id: String(o.id), type: String(o.type || ''), type_label: miniAppTypeLabel(o.type, o.upgrade_from_plan_id), upgrade_from_plan_id: String(o.upgrade_from_plan_id || ''),
      plan: [String(plan.title || o.plan_name || ''), String(panel.name || o.panel_name || '')].filter(Boolean).join(' · ') || (o.type === 'charge' ? 'شارژ کیف پول' : '—'),
      amount: Number(o.amount || 0), pay_amount: o.pay_amount == null ? null : Number(o.pay_amount),
      method: miniAppPaymentLabel(o.payment_method), payment_method: String(o.payment_method || ''),
      payment_status: String(o.payment_status || ''), receipt_submitted: !!o.receipt_submitted_at,
      status: 'pending', status_label: miniAppStatusLabel('pending'), created_at: Number(o.created_at || 0)
    });
    if (pendingOrders.length >= 5) break;
  }
  const enabled = Object.entries(panels || {}).filter(([, p]) => isRecordEnabled(p)).map(([key, p]) => Object.assign({}, p, { id: String(p.id || key) }));
  const products = [];
  for (const panel of enabled) {
    for (const plan of Object.values(plans || {})) {
      if (!isRecordEnabled(plan) || !planAssignedToPanel(plan, panel.id)) continue;
      const price = Number(plan.price);
      if (!Number.isSafeInteger(price) || price <= 0) continue;
      products.push({
        panel_id: String(panel.id), panel_name: String(panel.name || ''),
        plan_id: String(plan.id), title: String(plan.title || ''), gb: Number(plan.gb || 0),
        days: Number(plan.days || 0), price: price
      });
    }
  }
  products.sort((a,b) => a.price - b.price || a.title.localeCompare(b.title, 'fa'));
  const freeSubscription = await miniAppFreeSubscriptionAvailability(env, user, cfg, panels);
  return {
    ok: true,
    customer: {
      tg_id: tgId, first_name: String(user.first_name || ''), username: String(user.username || ''),
      balance: Number(user.balance || 0), total_spent: Number(user.total_spent || 0), joined_at: Number(user.joined_at || 0)
    },
    referral: referralInfo.summary,
    subscriptions: subscriptions.filter(Boolean), subscriptions_partial: allSubIds.length > subIds.length,
    orders: orders, orders_partial: orderIndex.has_more || orderIndex.key_count > 50,
    transactions: transactions.slice(0, 50), transactions_partial: orderIndex.has_more || ledgerIndex.has_more || withdrawalIndex.has_more || transactions.length > 50,
    pending_orders: pendingOrders, plans: products,
    free_subscription: freeSubscription,
    support: String(cfg.support || ''),
    payment_options: {
      manual: cfg.card_manual_enabled !== false && !!cfg.card_number,
      automatic: cfg.card_auto_enabled === true && !!env.SHETAB_API_SECRET && !!cfg.card_number
    }
  };
}

function miniAppRequestId(value) {
  const id = String(value || '');
  return /^[A-Za-z0-9_-]{8,80}$/.test(id) ? id : '';
}

async function findMiniAppPendingOrder(env, tgId, type, panelId, planId, subSid) {
  const rawPending = await kvGet(env, 'pend', []);
  const pending = Array.isArray(rawPending) ? rawPending : [];
  for (const id of pending.slice(-100).reverse()) {
    const order = await getOrder(env, id);
    if (!order || order.status !== 'pending' || String(order.tg_id) !== String(tgId) || String(order.plan_id) !== String(planId)) continue;
    if (type === 'buy' && order.type === 'buy' && String(order.panel_id) === String(panelId)) return order;
    if (type === 'renew' && order.type === 'renew' && String(order.sub_sid) === String(subSid)) return order;
  }
  return null;
}

async function findMiniAppPendingRenewal(env, tgId, subSid) {
  const rawPending = await kvGet(env, 'pend', []);
  const pending = Array.isArray(rawPending) ? rawPending : [];
  for (const id of pending.slice(-100).reverse()) {
    const order = await getOrder(env, id);
    if (order && order.status === 'pending' && String(order.tg_id) === String(tgId) &&
        order.type === 'renew' && String(order.sub_sid) === String(subSid)) return order;
  }
  return null;
}

async function miniAppSubscriptionDelivery(env, sub, plansArg, panelsArg) {
  if (!sub || !sub.uuid || !sub.panel_id) return null;
  const [plans, panels] = await Promise.all([plansArg || getPlans(env), panelsArg || getPanels(env)]);
  const panel = panels[String(sub.panel_id)];
  if (!panel) return null;
  const plan = plans[String(sub.plan_id)] || {};
  const link = userLink(panel, sub.uuid);
  if (!link) return null;
  let qr_data_url = '';
  try { qr_data_url = await subscriptionQrDataUrl(link); } catch (e) {}
  return {
    sid: String(sub.sid || ''), link: link, qr_data_url: qr_data_url,
    plan_title: String(plan.title || 'اشتراک تیزنت VPN'),
    panel_name: String(panel.name || 'سرور'),
    expires_at: Number(sub.expires_at || 0)
  };
}

async function miniAppOrderPayload(env, order) {
  const [cfg, plans, panels] = await Promise.all([getCfg(env), getPlans(env), getPanels(env)]);
  const plan = plans[String(order.plan_id)] || {};
  const panel = panels[String(order.panel_id)] || {};
  const method = String(order.payment_method || '');
  const amount = Number(order.amount || 0);
  const payAmount = Number(order.pay_amount == null ? amount : order.pay_amount);
  const cardNumber = String(order.payment_card_number || cfg.card_number || '').replace(/\s/g, '');
  const isOpenBankOrder = order.status === 'pending' && (method === 'manual' || method === 'shetab');
  let delivery = null;
  if (order.status === 'approved' && order.sub_sid && order.type !== 'charge') {
    const sub = await getSub(env, order.sub_sid);
    if (sub && String(sub.tg_id) === String(order.tg_id)) delivery = await miniAppSubscriptionDelivery(env, sub, plans, panels);
  }
  return {
    ok: true,
    reused: false,
    order: {
      id: String(order.id), type: String(order.type || ''), type_label: miniAppTypeLabel(order.type, order.upgrade_from_plan_id),
      upgrade_from_plan_id: String(order.upgrade_from_plan_id || ''), sub_sid: String(order.sub_sid || ''), status: String(order.status || 'unknown'),
      payment_method: method, payment_status: String(order.payment_status || ''),
      amount: amount, pay_amount: order.pay_amount == null ? null : payAmount,
      receipt_submitted: !!order.receipt_submitted_at,
      plan_title: String(plan.title || order.plan_name || ''), panel_name: String(panel.name || order.panel_name || ''),
      created_at: Number(order.created_at || 0), updated_at: Number(order.updated_at || 0),
      fulfillment_error: !!order.fulfillment_error
    },
    payment: isOpenBankOrder ? {
      card_number: cardNumber,
      card_holder: String(order.payment_card_holder || cfg.card_holder || ''),
      amount_toman: payAmount,
      amount_rial: rialFromToman(payAmount),
      method: method,
      requires_receipt: method === 'manual' && !order.receipt_submitted_at,
      receipt_submitted: !!order.receipt_submitted_at
    } : null,
    delivery: delivery
  };
}

async function miniAppOrderStatus(env, user, orderId) {
  const id = String(orderId || '').slice(0, 40);
  const order = id ? await getOrder(env, id) : null;
  if (!order || String(order.tg_id) !== String(user.tg_id)) return { data: { ok: false, error: 'order_not_found' }, status: 404 };
  return { data: await miniAppOrderPayload(env, order), status: 200 };
}

async function notifyMiniAppReceipt(env, order, photoFile, filename) {
  const plans = await getPlans(env);
  const panels = await getPanels(env);
  const plan = plans[String(order.plan_id)] || {};
  const panel = panels[String(order.panel_id)] || {};
  const buyer = '<a href="tg://user?id=' + order.tg_id + '">' + esc(order.first_name || order.username || order.tg_id) + '</a> (<code>' + order.tg_id + '</code>)';
  const t = '🧾 <b>رسید خرید از Mini App · سفارش #' + esc(order.id) + '</b>\n' +
    '👤 خریدار: ' + buyer +
    '\n📦 پلن: ' + esc(plan.title || order.plan_name || '—') +
    '\n🖥 سرور: ' + esc(panel.name || order.panel_name || '—') +
    '\n💵 مبلغ پلن: <b>' + fmtToman(order.amount) + '</b>' +
    (order.pay_amount != null ? '\n🏦 مبلغ دقیق انتقال: <b>' + fmtToman(order.pay_amount) + '</b>' : '') +
    (order.receipt_text ? '\n🔎 رسید/کد پیگیری: <code>' + esc(order.receipt_text).slice(0, 250) + '</code>' : '');
  const kb = KB([[BTN('✅ تأیید', 'a_ok:' + order.id), BTN('❌ رد', 'a_no:' + order.id)], [BTN('🔍 جزئیات', 'a_ord:' + order.id)]]);
  let successes = 0;
  let fileId = null;
  for (const id of adminIds(env)) {
    try {
      if (photoFile) {
        const sent = await sendPhotoUpload(env, id, photoFile, filename, t, kb);
        successes++;
        const photos = sent && Array.isArray(sent.photo) ? sent.photo : [];
        if (photos.length) fileId = photos[photos.length - 1].file_id || fileId;
      } else {
        await msg(env, id, t, kb);
        successes++;
      }
    } catch (e) {}
  }
  if (!successes) throw new Error('admin_notification_failed');
  return fileId;
}

async function miniAppSubmitReceipt(request, env, user, orderId) {
  const id = String(orderId || '').slice(0, 40);
  let order = id ? await getOrder(env, id) : null;
  if (!order || String(order.tg_id) !== String(user.tg_id)) return { data: { ok: false, error: 'order_not_found' }, status: 404 };
  if (order.status === 'approved' || order.payment_status === 'paid') return { data: await miniAppOrderPayload(env, order), status: 200 };
  if (order.status !== 'pending' || order.payment_method !== 'manual') return { data: { ok: false, error: 'manual_order_not_open' }, status: 409 };
  if (order.receipt_submitted_at) return { data: await miniAppOrderPayload(env, order), status: 200 };
  if (order.payment_status === 'review_uploading' && Date.now() - Number(order.receipt_upload_attempt_at || 0) < 45000) {
    return { data: { ok: false, error: 'receipt_processing' }, status: 409 };
  }
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 6 * 1024 * 1024) return { data: { ok: false, error: 'receipt_too_large' }, status: 413 };
  let form;
  try { form = await request.formData(); }
  catch (e) { return { data: { ok: false, error: 'invalid_receipt_form' }, status: 400 }; }
  const reference = cleanText(String(form.get('reference') || '')).trim().slice(0, 100);
  const candidate = form.get('receipt');
  const photo = candidate && typeof candidate === 'object' && typeof candidate.arrayBuffer === 'function' && Number(candidate.size) > 0 ? candidate : null;
  if (!photo && !reference) return { data: { ok: false, error: 'receipt_required' }, status: 400 };
  let filename = 'receipt.jpg';
  if (photo) {
    const mime = String(photo.type || '').toLowerCase();
    const name = String(photo.name || '').slice(0, 100);
    const extOk = /\.(jpe?g|png)$/i.test(name);
    if (!['image/jpeg', 'image/png'].includes(mime) && !extOk) return { data: { ok: false, error: 'receipt_image_type' }, status: 415 };
    if (Number(photo.size) > 5 * 1024 * 1024) return { data: { ok: false, error: 'receipt_too_large' }, status: 413 };
    filename = name.replace(/[^A-Za-z0-9._-]/g, '_') || 'receipt.jpg';
  }
  order.receipt_text = reference || (photo ? 'تصویر رسید از Mini App پیوست شد' : null);
  order.receipt_upload_attempt_at = Date.now();
  order.payment_status = 'review_uploading';
  await saveOrder(env, order);
  let fileId = null;
  try { fileId = await notifyMiniAppReceipt(env, order, photo, filename); }
  catch (e) {
    const latest = await getOrder(env, order.id) || order;
    if (latest.status === 'pending') { latest.payment_status = 'awaiting_receipt'; await saveOrder(env, latest); }
    return { data: { ok: false, error: 'receipt_forward_failed' }, status: 502 };
  }
  const latest = await getOrder(env, order.id) || order;
  if (latest.status === 'pending') {
    latest.receipt_file_id = fileId || latest.receipt_file_id || null;
    latest.receipt_submitted_at = Date.now();
    latest.payment_status = 'review';
    await saveOrder(env, latest);
    await recordCustomerActivity(env, user.tg_id, 'receipt_submitted', { order_id: order.id, amount: order.amount });
  }
  return { data: await miniAppOrderPayload(env, latest), status: 200 };
}

async function miniAppCreateCheckout(env, user, body) {
  const data = body && typeof body === 'object' ? body : {};
  const method = String(data.method || '');
  const planId = String(data.plan_id || '').slice(0, 40);
  const requestId = miniAppRequestId(data.request_id);
  if (!requestId) return { data: { ok: false, error: 'invalid_request_id' }, status: 400 };
  if (!['wallet', 'manual', 'shetab'].includes(method)) return { data: { ok: false, error: 'invalid_payment_method' }, status: 400 };
  const plans = await getPlans(env);
  const panels = await getPanels(env);
  const cfg = await getCfg(env);
  const subSid = String(data.sub_sid || '').slice(0, 40);
  const type = subSid ? 'renew' : 'buy';
  let panelId = String(data.panel_id || '').slice(0, 40);
  let sub = null;
  if (subSid) {
    sub = await getSub(env, subSid);
    if (!sub || String(sub.tg_id) !== String(user.tg_id)) return { data: { ok: false, error: 'subscription_not_found' }, status: 404 };
    panelId = String(sub.panel_id || '');
  }
  const panel = panels[panelId];
  const plan = plans[planId];
  if (!isRecordEnabled(panel) || !isRecordEnabled(plan)) return { data: { ok: false, error: 'plan_unavailable' }, status: 404 };
  if (!planAssignedToPanel(plan, panel.id || panelId)) return { data: { ok: false, error: 'plan_panel_mismatch' }, status: 400 };
  const amount = Number(plan.price);
  if (!Number.isSafeInteger(amount) || amount <= 0) return { data: { ok: false, error: 'invalid_plan_price' }, status: 400 };

  const idemKey = 'miniapp_idem:' + String(user.tg_id) + ':' + requestId;
  const previous = await kvGet(env, idemKey, null);
  if (previous && previous.order_id) {
    const previousOrder = await getOrder(env, previous.order_id);
    if (previousOrder && String(previousOrder.tg_id) === String(user.tg_id)) return { data: await miniAppOrderPayload(env, previousOrder), status: 200 };
  }
  const openOrder = await findMiniAppPendingOrder(env, user.tg_id, type, panelId, planId, subSid);
  if (openOrder) {
    await kvPut(env, idemKey, { order_id: String(openOrder.id) }, 86400);
    const response = await miniAppOrderPayload(env, openOrder);
    response.reused = true;
    return { data: response, status: 200 };
  }
  if (type === 'renew') {
    const otherPending = await findMiniAppPendingRenewal(env, user.tg_id, subSid);
    if (otherPending) return { data: { ok: false, error: 'subscription_has_pending_order', order_id: String(otherPending.id) }, status: 409 };
  }
  if (previous && previous.state === 'processing' && Date.now() - Number(previous.created_at || 0) < 60000) {
    return { data: { ok: false, error: 'checkout_processing' }, status: 409 };
  }

  if (method === 'manual' && (cfg.card_manual_enabled === false || !cfg.card_number)) return { data: { ok: false, error: 'manual_payment_disabled' }, status: 403 };
  if (method === 'shetab' && (cfg.card_auto_enabled !== true || !env.SHETAB_API_SECRET || !cfg.card_number)) return { data: { ok: false, error: 'automatic_payment_disabled' }, status: 403 };

  if (method === 'wallet') {
    const fresh = await getUser(env, user.tg_id) || user;
    if (Number(fresh.balance || 0) < amount) return { data: { ok: false, error: 'insufficient_balance', balance: Number(fresh.balance || 0), amount: amount }, status: 409 };
    const lockKey = 'miniapp_wallet_lock:' + String(user.tg_id);
    const held = await kvGet(env, lockKey, null);
    if (held && Date.now() - Number(held.created_at || 0) < 30000) {
      const heldOrder = held.order_id ? await getOrder(env, held.order_id) : null;
      if (heldOrder && String(heldOrder.tg_id) === String(user.tg_id)) return { data: await miniAppOrderPayload(env, heldOrder), status: 200 };
      return { data: { ok: false, error: 'checkout_processing' }, status: 409 };
    }
    await kvPut(env, idemKey, { state: 'processing', created_at: Date.now() }, 120);
    const order = await newOrder(env, {
      id: uid(8), tg_id: user.tg_id, username: user.username, first_name: user.first_name,
      type: type, panel_id: panelId, plan_id: planId, sub_sid: subSid || null,
      upgrade_from_plan_id: sub && String(sub.plan_id) !== planId ? String(sub.plan_id || '') : '',
      amount: amount, payment_method: 'wallet', payment_status: 'processing'
    });
    await kvPut(env, lockKey, { order_id: order.id, request_id: requestId, created_at: Date.now() }, 60);
    await kvPut(env, idemKey, { order_id: String(order.id) }, 86400);
    const debitUser = await getUser(env, user.tg_id) || fresh;
    if (Number(debitUser.balance || 0) < amount) {
      order.status = 'cancelled'; order.payment_status = 'insufficient_balance'; await saveOrder(env, order); await kvDel(env, lockKey);
      return { data: { ok: false, error: 'insufficient_balance', balance: Number(debitUser.balance || 0), amount: amount }, status: 409 };
    }
    debitUser.balance = Number(debitUser.balance || 0) - amount;
    await saveUser(env, debitUser);
    order.wallet_debited_at = Date.now();
    order.payment_status = 'paid'; order.payment_received_at = Date.now();
    await saveOrder(env, order);
    try {
      await approveOrder(env, order, { suppressCustomer: true });
      await notifyAdmins(env, '⚡ <b>خرید Mini App با کیف پول</b>\n👤 <code>' + user.tg_id + '</code>\n📦 ' + esc(plan.title) + '\n🖥 ' + esc(panel.name) + '\n💵 ' + fmtToman(amount));
      return { data: await miniAppOrderPayload(env, await getOrder(env, order.id) || order), status: 200 };
    } catch (e) {
      const latest = await getOrder(env, order.id) || order;
      if (latest.status === 'approved') return { data: await miniAppOrderPayload(env, latest), status: 200 };
      const refundUser = await getUser(env, user.tg_id);
      if (refundUser && !latest.wallet_refunded_at) {
        refundUser.balance = Number(refundUser.balance || 0) + amount;
        await saveUser(env, refundUser);
        latest.wallet_refunded_at = Date.now();
      }
      latest.status = 'cancelled'; latest.payment_status = 'refunded';
      latest.fulfillment_error = String((e && e.message) || e).slice(0, 300);
      await saveOrder(env, latest);
      await kvDel(env, lockKey);
      await notifyAdmins(env, '⚠️ <b>خرید کیف‌پولی Mini App با خطا مواجه شد</b>\n🧾 سفارش: <code>' + order.id + '</code>\nخطا: <code>' + esc(latest.fulfillment_error) + '</code>');
      return { data: { ok: false, error: 'wallet_purchase_failed_refunded', order_id: order.id }, status: 502 };
    } finally {
      await kvDel(env, lockKey);
    }
  }

  await kvPut(env, idemKey, { state: 'processing', created_at: Date.now() }, 120);
  const orderId = uid(8);
  let payAmount;
  try { payAmount = await reserveShetabAmount(env, amount, orderId); }
  catch (e) { await kvDel(env, idemKey); return { data: { ok: false, error: 'bank_amount_unavailable' }, status: 503 }; }
  const order = await newOrder(env, {
    id: orderId, tg_id: user.tg_id, username: user.username, first_name: user.first_name,
    type: type, panel_id: panelId, plan_id: planId, sub_sid: subSid || null,
    upgrade_from_plan_id: sub && String(sub.plan_id) !== planId ? String(sub.plan_id || '') : '',
    amount: amount, pay_amount: payAmount,
    payment_method: method, payment_status: method === 'manual' ? 'awaiting_receipt' : 'waiting',
    payment_card_number: String(cfg.card_number).replace(/\s/g, ''), payment_card_holder: String(cfg.card_holder || '')
  });
  await kvPut(env, idemKey, { order_id: String(order.id) }, 86400);
  return { data: await miniAppOrderPayload(env, order), status: 200 };
}


function miniAppAdminSettingsView(cfg, env) {
  return {
    ok: true,
    settings: {
      bot_username: String(cfg.bot_username || ''), support: String(cfg.support || ''),
      welcome: String(cfg.welcome || ''), card_number: String(cfg.card_number || ''),
      card_holder: String(cfg.card_holder || ''), commission: Number(cfg.commission || 0),
      min_withdraw: Number(cfg.min_withdraw || 0),
      card_manual_enabled: cfg.card_manual_enabled !== false,
      card_auto_enabled: cfg.card_auto_enabled === true,
      automatic_ready: !!env.SHETAB_API_SECRET && !!cfg.card_number,
      free_subscription_enabled: cfg.free_subscription_enabled === true,
      free_subscription_gb: Number.isFinite(Number(cfg.free_subscription_gb)) ? Number(cfg.free_subscription_gb) : 1,
      free_subscription_days: Number.isInteger(Number(cfg.free_subscription_days)) ? Number(cfg.free_subscription_days) : 1,
      free_subscription_panel_id: String(cfg.free_subscription_panel_id || ''),
      free_subscription_claim_policy: freeSubscriptionPolicy(cfg)
    },
    protected: ['BOT_TOKEN', 'WEBHOOK_SECRET', 'SHETAB_API_SECRET', 'ADMIN_IDS', 'Cloudflare bindings']
  };
}

async function miniAppAdminUpdateSettings(env, body) {
  const data = body && typeof body === 'object' ? body : {};
  const cfg = await getCfg(env);
  const autoWasEnabled = cfg.card_auto_enabled === true;
  const has = (key) => Object.prototype.hasOwnProperty.call(data, key);
  if (has('bot_username')) {
    const v = cleanText(data.bot_username).replace(/^@/, '');
    if (v && !/^[A-Za-z0-9_]{5,32}$/.test(v)) return { data: { ok: false, error: 'invalid_bot_username' }, status: 400 };
    cfg.bot_username = v;
  }
  if (has('support')) {
    const v = cleanText(data.support).replace(/^@/, '');
    if (v && !/^[A-Za-z0-9_]{5,32}$/.test(v)) return { data: { ok: false, error: 'invalid_support_username' }, status: 400 };
    cfg.support = v;
  }
  if (has('welcome')) {
    const v = String(data.welcome == null ? '' : data.welcome)
      .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '').trim();
    if (v.length > 1200) return { data: { ok: false, error: 'welcome_too_long' }, status: 400 };
    cfg.welcome = v;
  }
  if (has('card_number')) {
    const v = normDigits(data.card_number).replace(/[^\d]/g, '');
    if (v && !/^\d{12,19}$/.test(v)) return { data: { ok: false, error: 'invalid_card_number' }, status: 400 };
    cfg.card_number = v;
  }
  if (has('card_holder')) {
    const v = cleanText(data.card_holder).slice(0, 80);
    cfg.card_holder = v;
  }
  if (has('commission')) {
    const v = Number(normDigits(data.commission));
    if (!Number.isInteger(v) || v < 0 || v > 90) return { data: { ok: false, error: 'invalid_commission' }, status: 400 };
    cfg.commission = v;
  }
  if (has('min_withdraw')) {
    const v = parseMoney(data.min_withdraw);
    if (v == null || v < 0 || v > 1000000000) return { data: { ok: false, error: 'invalid_min_withdraw' }, status: 400 };
    cfg.min_withdraw = v;
  }
  for (const key of ['card_manual_enabled', 'card_auto_enabled']) {
    if (has(key) && typeof data[key] !== 'boolean') return { data: { ok: false, error: 'invalid_' + key }, status: 400 };
    if (has(key)) cfg[key] = data[key];
  }
  if (has('card_auto_enabled') && cfg.card_auto_enabled === true && !autoWasEnabled && (!env.SHETAB_API_SECRET || !cfg.card_number)) {
    return { data: { ok: false, error: 'automatic_payment_not_configured' }, status: 409 };
  }
  if (has('free_subscription_enabled')) {
    if (typeof data.free_subscription_enabled !== 'boolean') return { data: { ok: false, error: 'invalid_free_subscription_enabled' }, status: 400 };
    cfg.free_subscription_enabled = data.free_subscription_enabled;
  }
  if (has('free_subscription_gb')) {
    const v = parseNum(data.free_subscription_gb);
    if (v == null || v < 0 || v > 1000000) return { data: { ok: false, error: 'invalid_free_subscription_volume' }, status: 400 };
    cfg.free_subscription_gb = v;
  }
  if (has('free_subscription_days')) {
    const v = Number(normDigits(data.free_subscription_days));
    if (!Number.isInteger(v) || v < 1 || v > 3650) return { data: { ok: false, error: 'invalid_free_subscription_days' }, status: 400 };
    cfg.free_subscription_days = v;
  }
  if (has('free_subscription_panel_id')) {
    const v = cleanText(data.free_subscription_panel_id).slice(0, 40);
    if (v && !/^[A-Za-z0-9_-]{1,40}$/.test(v)) return { data: { ok: false, error: 'invalid_free_subscription_panel' }, status: 400 };
    cfg.free_subscription_panel_id = v;
  }
  if (has('free_subscription_claim_policy')) {
    const v = String(data.free_subscription_claim_policy || '');
    if (v && !['once_lifetime', 'one_active', 'repeat'].includes(v)) return { data: { ok: false, error: 'invalid_free_subscription_policy' }, status: 400 };
    if (!v && cfg.free_subscription_enabled === true) return { data: { ok: false, error: 'free_subscription_policy_required' }, status: 400 };
    cfg.free_subscription_claim_policy = v;
  }
  const freeFieldsChanged = ['free_subscription_enabled', 'free_subscription_gb', 'free_subscription_days', 'free_subscription_panel_id', 'free_subscription_claim_policy'].some(has);
  if (freeFieldsChanged && cfg.free_subscription_enabled === true) {
    if (!['once_lifetime', 'one_active', 'repeat'].includes(freeSubscriptionPolicy(cfg))) return { data: { ok: false, error: 'free_subscription_policy_required' }, status: 400 };
    const gb = Number(cfg.free_subscription_gb), days = Number(cfg.free_subscription_days);
    if (!Number.isFinite(gb) || gb < 0 || gb > 1000000) return { data: { ok: false, error: 'invalid_free_subscription_volume' }, status: 400 };
    if (!Number.isInteger(days) || days < 1 || days > 3650) return { data: { ok: false, error: 'invalid_free_subscription_days' }, status: 400 };
    const panels = await getPanels(env);
    const panel = panels[String(cfg.free_subscription_panel_id || '')];
    if (!panel || !isRecordEnabled(panel) || !panel.api_base || !panel.api_key || !panel.user_base) {
      return { data: { ok: false, error: 'free_subscription_panel_unavailable' }, status: 409 };
    }
  }
  if (has('card_number') && !cfg.card_number) cfg.card_auto_enabled = false;
  await saveCfg(env, cfg);
  return { data: miniAppAdminSettingsView(cfg, env), status: 200 };
}

function miniAppAdminPanelView(panel, fallbackId) {
  return {
    id: String(panel.id || fallbackId || ''), name: String(panel.name || ''), api_base: String(panel.api_base || ''),
    user_base: String(panel.user_base || ''), enabled: isRecordEnabled(panel),
    archived: panel.archived === true, api_key_set: !!panel.api_key
  };
}

async function miniAppAdminPanelList(env) {
  const panels = await getPanels(env);
  return { ok: true, items: Object.entries(panels || {}).map(([id, panel]) => miniAppAdminPanelView(panel, id)).sort((a,b) => a.name.localeCompare(b.name, 'fa')) };
}

function miniAppHttpsBase(value) {
  const raw = String(value || '').trim();
  let u;
  try { u = new URL(raw); } catch (e) { return ''; }
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) return '';
  return trimSlash(u.toString());
}

async function miniAppAdminPanelAction(env, body) {
  const data = body && typeof body === 'object' ? body : {};
  const action = String(data.action || '');
  const panels = await getPanels(env);
  const id = String(data.id || '').slice(0, 40);
  const old = id ? panels[id] : null;
  if (action === 'toggle' || action === 'archive') {
    if (!old) return { data: { ok: false, error: 'panel_not_found' }, status: 404 };
    if (action === 'toggle') { old.enabled = !isRecordEnabled(old); old.archived = false; delete old.archived_at; }
    else { old.enabled = false; old.archived = true; old.archived_at = Date.now(); }
    await savePanels(env, panels);
    return { data: { ok: true, panel: miniAppAdminPanelView(old), items: Object.entries(panels).map(([pid, panel]) => miniAppAdminPanelView(panel, pid)) }, status: 200 };
  }
  if (!['test', 'save'].includes(action)) return { data: { ok: false, error: 'invalid_panel_action' }, status: 400 };
  if (action === 'save' && data.id && !old) return { data: { ok: false, error: 'panel_not_found' }, status: 404 };
  const name = cleanText(data.name == null ? (old && old.name) : data.name).slice(0, 80);
  const apiBase = miniAppHttpsBase(data.api_base == null ? old && old.api_base : data.api_base);
  let userBase = miniAppHttpsBase(data.user_base == null ? old && old.user_base : data.user_base);
  userBase = stripTrailingUuid(userBase);
  const apiKeyInput = String(data.api_key || '').trim();
  const apiKey = apiKeyInput || String(old && old.api_key || '');
  if (!name) return { data: { ok: false, error: 'invalid_panel_name' }, status: 400 };
  if (!apiBase) return { data: { ok: false, error: 'invalid_panel_api_url' }, status: 400 };
  if (action === 'save' && !userBase) return { data: { ok: false, error: 'invalid_panel_user_url' }, status: 400 };
  if (!/^[0-9a-fA-F-]{30,64}$/.test(apiKey)) return { data: { ok: false, error: 'invalid_panel_api_key' }, status: 400 };
  try {
    const me = await hTest({ api_base: apiBase, api_key: apiKey });
    if (action === 'test') return { data: { ok: true, test: { name: String((me && (me.name || me.uuid)) || 'اتصال موفق'), mode: String((me && me.mode) || '') } }, status: 200 };
  } catch (e) {
    return { data: { ok: false, error: 'panel_connection_failed', detail: String(e.message || e).slice(0, 220) }, status: 422 };
  }
  const panelId = id || uid(6);
  const panel = Object.assign({}, old || {}, {
    id: panelId, name: name, api_base: apiBase, api_key: apiKey, user_base: userBase,
    enabled: old ? isRecordEnabled(old) : true, archived: false, updated_at: Date.now()
  });
  if (!old) panel.created_at = Date.now();
  delete panel.archived_at;
  panels[panelId] = panel;
  await savePanels(env, panels);
  return { data: { ok: true, panel: miniAppAdminPanelView(panel), items: Object.entries(panels).map(([pid, panel]) => miniAppAdminPanelView(panel, pid)) }, status: 200 };
}

function miniAppAdminPlanView(plan) {
  const assigned = normalisePlanPanelIds(plan);
  return {
    id: String(plan.id || ''), title: String(plan.title || ''), gb: Number(plan.gb || 0),
    days: Number(plan.days || 0), price: Number(plan.price || 0), panel_ids: assigned,
    enabled: isRecordEnabled(plan), archived: plan.archived === true
  };
}

async function miniAppAdminManagedPlans(env) {
  const [plans, panels] = await Promise.all([getPlans(env), getPanels(env)]);
  return {
    ok: true,
    items: Object.values(plans || {}).map((p) => Object.assign(miniAppAdminPlanView(p), {
      servers: Object.entries(panels || {}).filter(([key, x]) => x && planAssignedToPanel(p, x.id || key)).map(([key, x]) => String(x.name || x.id || key))
    })).sort((a,b) => a.price - b.price),
    panels: Object.entries(panels || {}).map(([key, p]) => ({ id: String(p.id || key), name: String(p.name || ''), enabled: isRecordEnabled(p) }))
  };
}

async function miniAppAdminPlanAction(env, body) {
  const data = body && typeof body === 'object' ? body : {};
  const action = String(data.action || '');
  const plans = await getPlans(env);
  const panels = await getPanels(env);
  const id = String(data.id || '').slice(0, 40);
  const old = id ? plans[id] : null;
  if (action === 'toggle' || action === 'archive') {
    if (!old) return { data: { ok: false, error: 'plan_not_found' }, status: 404 };
    if (action === 'toggle') { old.enabled = !isRecordEnabled(old); old.archived = false; delete old.archived_at; }
    else { old.enabled = false; old.archived = true; old.archived_at = Date.now(); }
    await savePlans(env, plans);
    return { data: { ok: true, plan: miniAppAdminPlanView(old) }, status: 200 };
  }
  if (action !== 'save') return { data: { ok: false, error: 'invalid_plan_action' }, status: 400 };
  if (data.id && !old) return { data: { ok: false, error: 'plan_not_found' }, status: 404 };
  const title = cleanText(data.title).slice(0, 80);
  const gb = Number(normDigits(data.gb));
  const days = Number(normDigits(data.days));
  const price = parseMoney(data.price);
  if (!title || !Number.isFinite(gb) || gb < 0 || gb > 1000000) return { data: { ok: false, error: 'invalid_plan_volume' }, status: 400 };
  const volume = Math.round(gb * 100) / 100;
  if (!Number.isInteger(days) || days < 1 || days > 3650) return { data: { ok: false, error: 'invalid_plan_days' }, status: 400 };
  if (price == null || !Number.isSafeInteger(price) || price < 1 || price > 1000000000) return { data: { ok: false, error: 'invalid_plan_price' }, status: 400 };
  let raw = Array.isArray(data.panel_ids) ? data.panel_ids : [];
  let panelIds = Array.from(new Set(raw.map((x) => String(x).slice(0, 40))));
  if (panelIds.includes('all')) panelIds = ['all'];
  else panelIds = panelIds.filter((pid) => panels[pid]);
  if (!panelIds.length) return { data: { ok: false, error: 'select_at_least_one_panel' }, status: 400 };
  const planId = id || uid(6);
  const plan = Object.assign({}, old || {}, {
    id: planId, title: title, gb: volume, days: days, price: price,
    panel_ids: panelIds, enabled: old ? isRecordEnabled(old) : true, archived: false,
    updated_at: Date.now()
  });
  if (!old) plan.created_at = Date.now();
  delete plan.archived_at;
  plans[planId] = plan;
  await savePlans(env, plans);
  return { data: { ok: true, plan: miniAppAdminPlanView(plan) }, status: 200 };
}


async function miniAppAdminOrderView(env, order) {
  if (!order) return null;
  const [plans, panels, user] = await Promise.all([
    getPlans(env), getPanels(env), getUser(env, order.tg_id)
  ]);
  const plan = plans[String(order.plan_id)] || {};
  const panel = panels[String(order.panel_id)] || {};
  const canEditProduct = order.status === 'pending' && order.payment_method === 'manual' &&
    order.payment_status !== 'paid' && !order.receipt_submitted_at && !order.receipt_text && !order.receipt_file_id;
  const legacyManualReceipt = order.payment_method === 'manual' && !order.receipt_upload_attempt_at && !!(order.receipt_text || order.receipt_file_id);
  const paymentVerified = order.payment_status === 'paid' || order.payment_status === 'review' || !!order.receipt_submitted_at || legacyManualReceipt;
  return {
    id: String(order.id), tg_id: String(order.tg_id || ''), first_name: String(order.first_name || (user && user.first_name) || ''),
    username: String(order.username || (user && user.username) || ''),
    type: String(order.type || ''), type_label: miniAppTypeLabel(order.type, order.upgrade_from_plan_id), upgrade_from_plan_id: String(order.upgrade_from_plan_id || ''),
    status: String(order.status || 'unknown'), status_label: miniAppStatusLabel(order.status),
    plan_id: String(order.plan_id || ''), plan_title: String(plan.title || order.plan_name || ''),
    panel_id: String(order.panel_id || ''), panel_name: String(panel.name || order.panel_name || ''),
    amount: Number(order.amount || 0), pay_amount: order.pay_amount == null ? null : Number(order.pay_amount),
    payment_method: String(order.payment_method || ''), payment_status: String(order.payment_status || ''),
    payment_ref: String(order.payment_ref || ''), receipt_text: String(order.receipt_text || ''),
    receipt_submitted: !!order.receipt_submitted_at, has_receipt_photo: !!order.receipt_file_id,
    receipt_verified: paymentVerified,
    manual_approval_available: order.status === 'pending' && order.payment_method !== 'wallet' && !paymentVerified,
    manual_approval: !!order.manual_approval, manual_approved_by: String(order.manual_approved_by || ''),
    manual_approved_at: Number(order.manual_approved_at || 0), manual_approval_note: String(order.manual_approval_note || ''),
    reject_reason: String(order.reject_reason || ''), admin_note: String(order.admin_note || ''),
    created_at: Number(order.created_at || 0), updated_at: Number(order.updated_at || 0),
    sub_sid: String(order.sub_sid || ''), editable: order.status === 'pending',
    can_edit_product: canEditProduct,
    plans: Object.values(plans || {}).map((p) => miniAppAdminPlanView(p)),
    panels: Object.entries(panels || {}).map(([key, p]) => ({ id: String(p.id || key), name: String(p.name || ''), enabled: isRecordEnabled(p) }))
  };
}

async function miniAppAdminOrderAction(env, adminId, orderId, body) {
  const id = String(orderId || '').slice(0, 40);
  const order = id ? await getOrder(env, id) : null;
  if (!order) return { data: { ok: false, error: 'order_not_found' }, status: 404 };
  const data = body && typeof body === 'object' ? body : {};
  const action = String(data.action || '');
  const lockKey = 'miniapp_admin_order_lock:' + id;
  const held = await kvGet(env, lockKey, null);
  if (held && Date.now() - Number(held.created_at || 0) < 45000) return { data: { ok: false, error: 'order_action_processing' }, status: 409 };
  await kvPut(env, lockKey, { admin_id: String(adminId), created_at: Date.now() }, 60);
  try {
    if (action === 'approve') {
      if (order.status !== 'pending') return { data: { ok: false, error: 'order_not_pending' }, status: 409 };
      const legacyManualReceipt = order.payment_method === 'manual' && !order.receipt_upload_attempt_at && !!(order.receipt_text || order.receipt_file_id);
      const paymentVerified = order.payment_status === 'paid' || order.payment_status === 'review' ||
        !!order.receipt_submitted_at || legacyManualReceipt;
      if (!paymentVerified) return { data: { ok: false, error: 'payment_not_verified' }, status: 409 };
      await approveOrder(env, order);
      const latest = await getOrder(env, id) || order;
      return { data: { ok: true, order: await miniAppAdminOrderView(env, latest) }, status: 200 };
    }
    if (action === 'approve_manual') {
      if (order.status !== 'pending') return { data: { ok: false, error: 'order_not_pending' }, status: 409 };
      if (order.payment_method === 'wallet') return { data: { ok: false, error: 'manual_wallet_approval_not_allowed' }, status: 409 };
      const legacyManualReceipt = order.payment_method === 'manual' && !order.receipt_upload_attempt_at && !!(order.receipt_text || order.receipt_file_id);
      const paymentVerified = order.payment_status === 'paid' || order.payment_status === 'review' || !!order.receipt_submitted_at || legacyManualReceipt;
      if (paymentVerified) return { data: { ok: false, error: 'payment_already_verified_use_standard_approval' }, status: 409 };
      if (data.payment_received_confirmed !== true) return { data: { ok: false, error: 'manual_payment_confirmation_required' }, status: 400 };
      order.manual_approval = true;
      order.manual_approved_by = String(adminId);
      order.manual_approved_at = Date.now();
      order.manual_approval_note = cleanText(data.manual_note || '').slice(0, 300);
      order.payment_status = 'paid';
      order.payment_received_at = order.payment_received_at || Date.now();
      await saveOrder(env, order);
      await recordCustomerActivity(env, order.tg_id, 'order_manual_payment_approved', {
        order_id: order.id, kind: order.type, amount: order.amount, actor_id: adminId
      });
      await approveOrder(env, order);
      const latest = await getOrder(env, id) || order;
      return { data: { ok: true, order: await miniAppAdminOrderView(env, latest) }, status: 200 };
    }
    if (action === 'reject') {
      if (order.status !== 'pending') return { data: { ok: false, error: 'order_not_pending' }, status: 409 };
      if (order.payment_status === 'paid') return { data: { ok: false, error: 'paid_order_cannot_reject' }, status: 409 };
      const reason = cleanText(data.reason || '').slice(0, 300);
      if (order.payment_method === 'wallet' && order.wallet_debited_at && !order.wallet_refunded_at) {
        const customer = await getUser(env, order.tg_id);
        if (customer) {
          customer.balance = Number(customer.balance || 0) + Number(order.amount || 0);
          await saveUser(env, customer);
          order.wallet_refunded_at = Date.now();
        }
      }
      order.status = 'rejected'; order.reject_reason = reason; order.rejected_by = String(adminId); order.rejected_at = Date.now();
      if (order.wallet_refunded_at) order.payment_status = 'refunded';
      await saveOrder(env, order);
      await recordCustomerActivity(env, order.tg_id, 'order_rejected', { order_id: order.id, kind: order.type, amount: order.amount, actor_id: adminId });
      try { await msg(env, order.tg_id, '❌ <b>سفارش شما رد شد.</b>\n\n🧾 شماره: <code>' + esc(order.id) + '</code>' +
        (reason ? '\n📝 دلیل: ' + esc(reason) : '') + (order.wallet_refunded_at ? '\n💰 مبلغ کیف پول برگشت داده شد.' : '') +
        '\n\nبرای پیگیری با پشتیبانی فروشگاه تماس بگیرید.'); } catch (e) {}
      return { data: { ok: true, order: await miniAppAdminOrderView(env, order) }, status: 200 };
    }
    if (action === 'edit') {
      if (!['pending', 'approved', 'rejected', 'cancelled'].includes(order.status)) return { data: { ok: false, error: 'order_not_editable' }, status: 409 };
      const note = String(data.admin_note == null ? order.admin_note || '' : data.admin_note).trim().slice(0, 500);
      order.admin_note = note;
      const changeProduct = data.change_product === true;
      if (changeProduct) {
        if (order.status !== 'pending' || order.payment_method !== 'manual' || order.payment_status === 'paid' || order.receipt_submitted_at || order.receipt_text || order.receipt_file_id) {
          return { data: { ok: false, error: 'financial_order_locked' }, status: 409 };
        }
        if (order.type === 'charge') {
          const amount = parseMoney(data.amount);
          if (amount == null || amount < 1000 || amount > 1000000000) return { data: { ok: false, error: 'invalid_order_amount' }, status: 400 };
          const oldAmount = Number(order.amount || 0);
          const oldPayAmount = order.pay_amount == null ? null : Number(order.pay_amount);
          order.amount = amount;
          order.plan_name = 'شارژ کیف پول';
          if (oldPayAmount != null) {
            const suffix = oldPayAmount - oldAmount;
            order.pay_amount = amount + (suffix >= 10 && suffix <= 999 ? suffix : 0);
          }
        } else if (order.type === 'buy' || order.type === 'renew') {
          const plans = await getPlans(env); const panels = await getPanels(env);
          const plan = plans[String(data.plan_id || '')];
          let panelId = String(data.panel_id || order.panel_id || '');
          if (order.type === 'renew') {
            const sub = await getSub(env, order.sub_sid);
            if (!sub || String(sub.tg_id) !== String(order.tg_id)) return { data: { ok: false, error: 'subscription_not_found' }, status: 404 };
            panelId = String(sub.panel_id || '');
          }
          const panel = panels[panelId];
          if (!isRecordEnabled(plan) || !isRecordEnabled(panel) || !planAssignedToPanel(plan, panelId)) return { data: { ok: false, error: 'invalid_order_product' }, status: 400 };
          const oldAmount = Number(order.amount || 0);
          const oldPayAmount = order.pay_amount == null ? null : Number(order.pay_amount);
          order.plan_id = String(plan.id); order.panel_id = panelId; order.amount = Number(plan.price);
          order.plan_name = String(plan.title || ''); order.panel_name = String(panel.name || '');
          if (oldPayAmount != null) {
            const suffix = oldPayAmount - oldAmount;
            order.pay_amount = order.amount + (suffix >= 10 && suffix <= 999 ? suffix : 0);
          }
        } else return { data: { ok: false, error: 'order_type_not_editable' }, status: 409 };
      }
      order.edited_at = Date.now(); order.edited_by = String(adminId);
      await saveOrder(env, order);
      return { data: { ok: true, order: await miniAppAdminOrderView(env, order) }, status: 200 };
    }
    return { data: { ok: false, error: 'invalid_order_action' }, status: 400 };
  } catch (e) {
    const latest = await getOrder(env, id);
    if ((action === 'approve' || action === 'approve_manual') && latest && latest.status === 'approved') {
      return { data: { ok: true, order: await miniAppAdminOrderView(env, latest), notification_warning: true }, status: 200 };
    }
    return { data: { ok: false, error: 'order_action_failed', detail: String(e.message || e).slice(0, 240) }, status: 502 };
  } finally {
    await kvDel(env, lockKey);
  }
}

async function miniAppAdminCustomerAction(env, adminId, tgid, body) {
  const userId = String(tgid || '').replace(/[^0-9]/g, '').slice(0, 20);
  const user = userId ? await getUser(env, userId) : null;
  if (!user) return { data: { ok: false, error: 'customer_not_found' }, status: 404 };
  const data = body && typeof body === 'object' ? body : {};
  const action = String(data.action || '');
  if (['ban', 'unban'].includes(action)) {
    if (isAdmin(env, userId)) return { data: { ok: false, error: 'admin_cannot_be_banned' }, status: 403 };
    user.banned = action === 'ban';
    await saveUser(env, user);
    await recordCustomerActivity(env, userId, action === 'ban' ? 'customer_banned' : 'customer_unbanned', { actor_id: adminId });
  } else if (action === 'credit' || action === 'debit') {
    const amount = parseMoney(data.amount);
    if (amount == null || amount < 1 || amount > 1000000000) return { data: { ok: false, error: 'invalid_customer_amount' }, status: 400 };
    if (action === 'debit' && Number(user.balance || 0) < amount) return { data: { ok: false, error: 'insufficient_customer_balance' }, status: 409 };
    user.balance = Number(user.balance || 0) + (action === 'credit' ? amount : -amount);
    await saveUser(env, user);
    const ledgerId = 'admin-' + uid(10);
    await recordLedgerSafely(env, {
      id: ledgerId, kind: 'wallet_adjustment', type: action === 'credit' ? 'admin_credit' : 'admin_debit',
      tg_id: String(userId), amount: amount, payment_method: 'admin', actor_id: String(adminId),
      balance_after: Number(user.balance || 0), occurred_at: Date.now()
    });
    await recordCustomerActivity(env, userId, action === 'credit' ? 'wallet_credit_admin' : 'wallet_debit_admin', { amount: amount, actor_id: adminId });
    try { await msg(env, userId, (action === 'credit' ? '✅ ' : 'ℹ️ ') + 'کیف پول شما توسط مدیریت ' + (action === 'credit' ? 'به مبلغ ' : 'به میزان ') + fmtToman(amount) + (action === 'credit' ? ' شارژ شد.' : ' کاهش یافت.') + '\n💰 موجودی فعلی: ' + fmtToman(user.balance)); } catch (e) {}
  } else return { data: { ok: false, error: 'invalid_customer_action' }, status: 400 };
  return { data: { ok: true, customer: { tg_id: String(user.tg_id), first_name: String(user.first_name || ''), username: String(user.username || ''), balance: Number(user.balance || 0), banned: !!user.banned } }, status: 200 };
}

async function miniAppAdminWithdrawals(env) {
  const ids = await kvGet(env, 'wpend', []);
  const items = [];
  for (const id of (Array.isArray(ids) ? ids.slice(-100).reverse() : [])) {
    const w = await getWithdraw(env, id);
    if (!w || w.status !== 'pending') continue;
    const u = await getUser(env, w.tg_id);
    items.push({ id: String(w.id), tg_id: String(w.tg_id), first_name: String((u && u.first_name) || ''),
      username: String((u && u.username) || ''), amount: Number(w.amount || 0), card: String(w.card || ''),
      status: String(w.status), created_at: Number(w.created_at || 0) });
  }
  return { ok: true, items: items };
}

async function miniAppAdminWithdrawalAction(env, adminId, wid, body) {
  const id = String(wid || '').slice(0, 40);
  const w = id ? await getWithdraw(env, id) : null;
  if (!w) return { data: { ok: false, error: 'withdrawal_not_found' }, status: 404 };
  if (w.status !== 'pending') return { data: { ok: false, error: 'withdrawal_not_pending' }, status: 409 };
  const lockKey = 'miniapp_admin_withdraw_lock:' + id;
  const held = await kvGet(env, lockKey, null);
  if (held && Date.now() - Number(held.created_at || 0) < 45000) return { data: { ok: false, error: 'withdrawal_action_processing' }, status: 409 };
  await kvPut(env, lockKey, { admin_id: String(adminId), created_at: Date.now() }, 60);
  try {
    const action = String(body && body.action || '');
    const u = await getUser(env, w.tg_id);
    if (action === 'approve') {
      w.status = 'approved'; w.approved_by = String(adminId); w.approved_at = Date.now();
      await saveWithdraw(env, w);
      await recordCustomerActivity(env, w.tg_id, 'withdrawal_approved', { amount: w.amount, actor_id: adminId });
      try { await msg(env, w.tg_id, '✅ <b>درخواست برداشت شما پرداخت شد.</b>\n💵 مبلغ: ' + fmtToman(w.amount) + '\n💳 کارت مقصد: <code>' + esc(w.card || '') + '</code>'); } catch (e) {}
    } else if (action === 'reject') {
      if (!u) return { data: { ok: false, error: 'customer_not_found' }, status: 404 };
      w.status = 'rejected'; w.rejected_by = String(adminId); w.rejected_at = Date.now();
      if (!w.refunded_at) { u.balance = Number(u.balance || 0) + Number(w.amount || 0); await saveUser(env, u); w.refunded_at = Date.now(); }
      await saveWithdraw(env, w);
      await recordCustomerActivity(env, w.tg_id, 'withdrawal_rejected', { amount: w.amount, actor_id: adminId });
      try { await msg(env, w.tg_id, '❌ <b>درخواست برداشت رد شد.</b> مبلغ ' + fmtToman(w.amount) + ' به کیف پول شما برگشت داده شد.'); } catch (e) {}
    } else return { data: { ok: false, error: 'invalid_withdrawal_action' }, status: 400 };
    return { data: { ok: true, id: String(w.id), status: String(w.status) }, status: 200 };
  } finally { await kvDel(env, lockKey); }
}

const AGENT_CREATE_MUTEX = new Map();
async function recordAgentLedger(env, agentId, entry) {
  const owner = miniAppAgentId(agentId);
  if (!owner) throw new Error('invalid_agent_id');
  const data = entry && typeof entry === 'object' ? entry : {};
  const id = String(data.id || ('al-' + uid(12))).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48);
  const key = 'agent_ledger:' + owner + ':' + id;
  const existing = await kvGet(env, key, null);
  if (existing) return existing;
  const at = Number(data.occurred_at || Date.now());
  const row = Object.assign({}, data, {
    id: id, agent_id: owner, amount: Math.max(0, Number(data.amount || 0)),
    occurred_at: at, created_at: at
  });
  await kvPut(env, key, row);
  const indexed = await putIndexSafely(env, 'agent_ledger_idx:' + owner + ':' + reverseIndexTime(at) + ':' + id, {
    id: id, occurred_at: at
  });
  if (!indexed) throw new Error('agent_ledger_index_failed');
  return row;
}
function miniAppAgentPlanPrice(agent, plan) {
  const id = String(plan && plan.id || '');
  const prices = agent && agent.plan_prices && typeof agent.plan_prices === 'object' ? agent.plan_prices : {};
  const raw = Object.prototype.hasOwnProperty.call(prices, id) ? prices[id] : plan && plan.price;
  const price = Number(raw);
  return Number.isSafeInteger(price) && price > 0 ? price : 0;
}
async function miniAppAgentSubscriptionView(env, sub, plansArg, panelsArg) {
  if (!sub || !sub.uuid) return null;
  const [plans, panels] = await Promise.all([plansArg || getPlans(env), panelsArg || getPanels(env)]);
  const panel = panels[String(sub.panel_id || '')] || null;
  const plan = plans[String(sub.plan_id || '')] || {};
  let live = null;
  if (panel && panel.api_base) { try { live = await hGetLive(panel, sub.uuid); } catch (e) {} }
  const total = live && live.usage_limit_GB != null ? Number(live.usage_limit_GB) : Number(plan.gb || 0);
  const used = live && live.current_usage_GB != null ? Number(live.current_usage_GB) : 0;
  const remaining = planRemaining(live || {});
  let link = '';
  if (panel && panel.user_base) {
    try { const parsed = new URL(userLink(panel, sub.uuid)); if (parsed.protocol === 'https:') link = parsed.toString(); } catch (e) {}
  }
  const status = !live ? 'unknown' : (live.is_active !== false && live.enable !== false && !(remaining.days != null && remaining.days <= 0) ? 'active' : 'expired');
  return {
    sid: String(sub.sid || ''), customer_name: String(sub.customer_name || ''),
    panel_id: String(sub.panel_id || ''), plan_id: String(sub.plan_id || ''),
    panel_name: String(panel ? panel.name || '' : sub.panel_name || 'سرور حذف‌شده'),
    plan_name: String(plan.title || sub.plan_name || 'پلن حذف‌شده'),
    agent_price: Number(sub.agent_price || 0),
    status: status, status_label: status === 'active' ? 'فعال' : status === 'expired' ? 'منقضی/غیرفعال' : 'وضعیت نامشخص',
    usage_used: Number.isFinite(used) ? used : 0,
    usage_total: Number.isFinite(total) ? total : 0,
    usage_unlimited: total === 0 || total >= 100000,
    days_remaining: remaining.days == null ? null : remaining.days,
    expires_at: remaining.expiry ? remaining.expiry.toISOString() : null,
    created_at: Number(sub.created_at || 0), link: link
  };
}
async function miniAppAgentSubscriptions(env, agentId, limit) {
  const owner = miniAppAgentId(agentId);
  const max = Math.max(1, Math.min(100, Number(limit) || 40));
  const index = await listIndexedValues(env, 'agent_sub_idx:' + owner + ':', max);
  const [plans, panels] = await Promise.all([getPlans(env), getPanels(env)]);
  const rows = await Promise.all(index.items.map(async (item) => {
    const sid = String(item && item.sid || '');
    const sub = sid ? await getSub(env, sid) : null;
    if (!sub || String(sub.agent_id || '') !== owner) return null;
    return miniAppAgentSubscriptionView(env, sub, plans, panels);
  }));
  return { items: rows.filter(Boolean), partial: index.has_more, count: index.key_count };
}
async function miniAppAgentTransactions(env, agentId, limit) {
  const owner = miniAppAgentId(agentId);
  const max = Math.max(1, Math.min(100, Number(limit) || 50));
  const index = await listIndexedValues(env, 'agent_ledger_idx:' + owner + ':', max);
  const rows = await Promise.all(index.items.map(async (item) => item && item.id ? await kvGet(env, 'agent_ledger:' + owner + ':' + String(item.id), null) : null));
  return { items: rows.filter(Boolean).map((row) => ({
    id: String(row.id || ''), type: String(row.type || ''), direction: String(row.direction || 'out'),
    amount: Number(row.amount || 0), balance_after: Number(row.balance_after || 0),
    quota_after: row.quota_after == null ? null : Number(row.quota_after),
    description: String(row.description || ''), plan_id: String(row.plan_id || ''),
    subscription_sid: String(row.subscription_sid || ''), actor_id: String(row.actor_id || ''),
    occurred_at: Number(row.occurred_at || row.created_at || 0)
  })), partial: index.has_more };
}
async function miniAppAgentOverview(env, agent, user) {
  const [plans, panels, subscriptions, transactions] = await Promise.all([
    getPlans(env), getPanels(env),
    miniAppAgentSubscriptions(env, agent.tg_id, 40),
    miniAppAgentTransactions(env, agent.tg_id, 50)
  ]);
  const products = [];
  for (const [panelKey, panel] of Object.entries(panels || {})) {
    if (!isRecordEnabled(panel)) continue;
    const panelId = String(panel.id || panelKey);
    for (const [planKey, plan] of Object.entries(plans || {})) {
      if (!isRecordEnabled(plan) || !planAssignedToPanel(plan, panelId)) continue;
      const price = await miniAppAgentPlanPrice(agent, Object.assign({}, plan, { id: String(plan.id || planKey) }));
      if (!price) continue;
      products.push({
        panel_id: panelId, panel_name: String(panel.name || ''),
        plan_id: String(plan.id || planKey), title: String(plan.title || ''),
        gb: Number(plan.gb || 0), days: Number(plan.days || 0),
        agent_price: price, public_price: Number(plan.price || 0)
      });
    }
  }
  products.sort((a,b) => a.agent_price - b.agent_price || a.title.localeCompare(b.title, 'fa'));
  return {
    ok: true, agent: miniAppAgentView(agent, user), products: products,
    subscriptions: subscriptions.items, subscriptions_partial: subscriptions.partial,
    transactions: transactions.items, transactions_partial: transactions.partial
  };
}
async function miniAppAdminAgents(env, query) {
  const q = cleanText(query || '').toLowerCase().slice(0, 80);
  const result = await env.DB.list({ prefix: 'agent:', limit: 500 });
  const values = await Promise.all((result.keys || []).map((key) => kvGet(env, key.name, null)));
  const agents = values.filter((agent) => agent && miniAppAgentId(agent.tg_id));
  const items = await Promise.all(agents.map(async (agent) => {
    const user = await getUser(env, agent.tg_id);
    return miniAppAgentView(agent, user);
  }));
  const filtered = items.filter((item) => !q || [item.tg_id, item.first_name, item.username].join(' ').toLowerCase().includes(q));
  filtered.sort((a,b) => Number(b.created_at || 0) - Number(a.created_at || 0));
  return { ok: true, items: filtered, partial: !result.list_complete, total: agents.length };
}
async function miniAppAdminAgentDetail(env, tgid) {
  const id = miniAppAgentId(tgid);
  const agent = id ? await getAgent(env, id) : null;
  if (!agent) return { ok: false, error: 'agent_not_found' };
  const [user, plans, panels, subscriptions, transactions] = await Promise.all([
    getUser(env, id), getPlans(env), getPanels(env),
    miniAppAgentSubscriptions(env, id, 60), miniAppAgentTransactions(env, id, 60)
  ]);
  const planRows = Object.entries(plans || {}).map(([key, plan]) => {
    const id = String(plan && plan.id || key);
    return {
      id: id, title: String(plan && plan.title || ''), gb: Number(plan && plan.gb || 0),
      days: Number(plan && plan.days || 0), enabled: isRecordEnabled(plan), archived: !!(plan && plan.archived),
      public_price: Number(plan && plan.price || 0), agent_price: miniAppAgentPlanPrice(agent, Object.assign({}, plan || {}, { id: id }))
    };
  }).sort((a,b) => a.title.localeCompare(b.title, 'fa'));
  return {
    ok: true, agent: miniAppAgentView(agent, user),
    plans: planRows,
    panels: Object.entries(panels || {}).map(([key, panel]) => ({ id: String(panel.id || key), name: String(panel.name || ''), enabled: isRecordEnabled(panel) })),
    subscriptions: subscriptions.items, subscriptions_partial: subscriptions.partial,
    transactions: transactions.items, transactions_partial: transactions.partial
  };
}
async function miniAppAdminPromoteAgent(env, adminId, body) {
  const id = miniAppAgentId(body && (body.tg_id || body.telegram_id));
  if (!id) return { data: { ok: false, error: 'invalid_agent_id' }, status: 400 };
  if (isAdmin(env, id)) return { data: { ok: false, error: 'admin_cannot_be_agent' }, status: 403 };
  const user = await getUser(env, id);
  if (!user) return { data: { ok: false, error: 'agent_user_not_found' }, status: 404 };
  if (user.banned) return { data: { ok: false, error: 'agent_user_blocked' }, status: 409 };
  if (await getAgent(env, id)) return { data: { ok: false, error: 'agent_already_exists' }, status: 409 };
  const agent = await createAgentRecord(env, id, user, adminId);
  if (!agent) return { data: { ok: false, error: 'agent_already_exists' }, status: 409 };
  return { data: { ok: true, agent: miniAppAgentView(agent, user) }, status: 200 };
}
async function miniAppAdminAgentInvites(env, adminId, body) {
  const data = body && typeof body === 'object' ? body : {};
  const action = String(data.action || 'create');
  if (action === 'revoke') {
    const code = String(data.code || '').trim();
    if (!/^[A-Z2-9]{10,32}$/.test(code)) return { data: { ok: false, error: 'invalid_agent_invite' }, status: 400 };
    if (AGENT_INVITE_MUTEX.has(code)) return { data: { ok: false, error: 'agent_invite_processing' }, status: 409 };
    const inviteLock = await kvGet(env, 'agent_invite_lock:' + code, null);
    if (AGENT_INVITE_MUTEX.has(code) || (inviteLock && Date.now() - Number(inviteLock.started_at || 0) < 30000)) return { data: { ok: false, error: 'agent_invite_processing' }, status: 409 };
    const invite = await kvGet(env, 'agent_invite:' + code, null);
    if (!invite) return { data: { ok: false, error: 'agent_invite_not_found' }, status: 404 };
    if (invite.used_by) return { data: { ok: false, error: 'agent_invite_already_used' }, status: 409 };
    invite.active = false; invite.revoked_by = String(adminId); invite.revoked_at = Date.now();
    await kvPut(env, 'agent_invite:' + code, invite, Math.max(60, Math.ceil((Number(invite.expires_at || Date.now() + 60000) - Date.now()) / 1000)));
    return { data: { ok: true, code: code }, status: 200 };
  }
  if (action !== 'create') return { data: { ok: false, error: 'invalid_agent_invite_action' }, status: 400 };
  const cfg = await getCfg(env);
  const botName = await ensureBotUsername(env, cfg);
  if (!botName) return { data: { ok: false, error: 'agent_bot_username_missing' }, status: 503 };
  const code = uid(18);
  const now = Date.now();
  const invite = { code: code, active: true, created_by: String(adminId), created_at: now, expires_at: now + 30 * 86400000, used_by: '', used_at: 0 };
  await kvPut(env, 'agent_invite:' + code, invite, 30 * 86400);
  const indexed = await putIndexSafely(env, 'agent_invite_idx:' + reverseIndexTime(now) + ':' + code, { code: code, created_at: now });
  if (!indexed) { await kvDel(env, 'agent_invite:' + code); return { data: { ok: false, error: 'agent_invite_create_failed' }, status: 500 }; }
  const link = safeBotStartLink(botName, 'agent_' + code);
  if (!link) { await kvDel(env, 'agent_invite:' + code); return { data: { ok: false, error: 'agent_bot_username_missing' }, status: 503 }; }
  return { data: { ok: true, code: code, url: link, expires_at: invite.expires_at }, status: 200 };
}
async function miniAppAdminAgentInviteList(env) {
  const index = await listIndexedValues(env, 'agent_invite_idx:', 100);
  const cfg = await getCfg(env);
  const botName = await ensureBotUsername(env, cfg);
  const items = await Promise.all(index.items.map(async (item) => {
    const code = String(item && item.code || '');
    const invite = code ? await kvGet(env, 'agent_invite:' + code, null) : null;
    if (!invite) return null;
    const active = invite.active === true && !invite.used_by && Number(invite.expires_at || 0) > Date.now();
    return {
      code: code, active: active, url: active && botName ? safeBotStartLink(botName, 'agent_' + code) : '',
      used_by: String(invite.used_by || ''), created_at: Number(invite.created_at || 0),
      expires_at: Number(invite.expires_at || 0)
    };
  }));
  return { ok: true, items: items.filter(Boolean), partial: index.has_more };
}
async function miniAppAdminAgentAction(env, adminId, tgid, body) {
  const id = miniAppAgentId(tgid);
  const agent = id ? await getAgent(env, id) : null;
  if (!agent) return { data: { ok: false, error: 'agent_not_found' }, status: 404 };
  const data = body && typeof body === 'object' ? body : {};
  const action = String(data.action || '');
  if (AGENT_CREATE_MUTEX.has(id)) return { data: { ok: false, error: 'agent_creation_processing' }, status: 409 };
  const lock = await kvGet(env, 'agent_create_lock:' + id, null);
  if (AGENT_CREATE_MUTEX.has(id) || (lock && Date.now() - Number(lock.started_at || 0) < 120000)) return { data: { ok: false, error: 'agent_creation_processing' }, status: 409 };
  if (action === 'toggle') {
    agent.enabled = !isRecordEnabled(agent);
    await saveAgent(env, agent);
    return { data: { ok: true, agent: miniAppAgentView(agent, await getUser(env, id)) }, status: 200 };
  }
  if (action === 'save') {
    if (typeof data.enabled === 'boolean') agent.enabled = data.enabled;
    if (data.plan_prices != null) {
      if (!data.plan_prices || typeof data.plan_prices !== 'object' || Array.isArray(data.plan_prices)) return { data: { ok: false, error: 'invalid_agent_prices' }, status: 400 };
      const plans = await getPlans(env);
      const prices = Object.assign({}, agent.plan_prices || {});
      for (const [planIdRaw, raw] of Object.entries(data.plan_prices)) {
        const planId = String(planIdRaw).slice(0, 40);
        if (!plans[planId]) continue;
        const price = parseMoney(raw);
        if (price == null || !Number.isSafeInteger(price) || price < 1 || price > 1000000000) return { data: { ok: false, error: 'invalid_agent_price' }, status: 400 };
        prices[planId] = price;
      }
      agent.plan_prices = prices;
    }
    await saveAgent(env, agent);
    return { data: { ok: true, agent: miniAppAgentView(agent, await getUser(env, id)) }, status: 200 };
  }
  if (action === 'credit' || action === 'debit') {
    const amount = parseMoney(data.amount);
    if (amount == null || !Number.isSafeInteger(amount) || amount < 1 || amount > 1000000000) return { data: { ok: false, error: 'invalid_agent_amount' }, status: 400 };
    const balance = Math.max(0, Number(agent.balance || 0));
    if (action === 'debit' && balance < amount) return { data: { ok: false, error: 'insufficient_agent_balance' }, status: 409 };
    agent.balance = balance + (action === 'credit' ? amount : -amount);
    await saveAgent(env, agent);
    await recordAgentLedger(env, id, {
      id: 'admin-' + uid(12), type: action === 'credit' ? 'admin_credit' : 'admin_debit',
      direction: action === 'credit' ? 'in' : 'out', amount: amount,
      balance_after: agent.balance, actor_id: String(adminId),
      description: action === 'credit' ? 'شارژ کیف پول نماینده توسط مدیر' : 'کسر از کیف پول نماینده توسط مدیر'
    });
    return { data: { ok: true, agent: miniAppAgentView(agent, await getUser(env, id)) }, status: 200 };
  }
  if (action === 'quota_set') {
    const raw = normDigits(data.amount).trim();
    if (!/^\d{1,7}$/.test(raw)) return { data: { ok: false, error: 'invalid_agent_quota' }, status: 400 };
    const quota = Number(raw);
    if (!Number.isSafeInteger(quota) || quota < 0 || quota > 1000000) return { data: { ok: false, error: 'invalid_agent_quota' }, status: 400 };
    const previous = Math.max(0, Math.floor(Number(agent.quota_remaining || 0)));
    agent.quota_remaining = quota;
    await saveAgent(env, agent);
    await recordAgentLedger(env, id, {
      id: 'admin-quota-' + uid(12), type: 'admin_quota_set', direction: quota >= previous ? 'in' : 'out',
      amount: Math.abs(quota - previous), quota_after: quota, balance_after: Number(agent.balance || 0),
      actor_id: String(adminId), description: 'تنظیم سهمیهٔ ساخت توسط مدیر'
    });
    return { data: { ok: true, agent: miniAppAgentView(agent, await getUser(env, id)) }, status: 200 };
  }
  return { data: { ok: false, error: 'invalid_agent_action' }, status: 400 };
}
async function miniAppAgentCreateSubscription(env, agentId, body) {
  const owner = miniAppAgentId(agentId);
  const data = body && typeof body === 'object' ? body : {};
  const requestId = miniAppRequestId(data.request_id);
  const planId = String(data.plan_id || '').slice(0, 40);
  const panelId = String(data.panel_id || '').slice(0, 40);
  const customerName = cleanText(data.customer_name || '').slice(0, 80);
  if (!owner || !requestId) return { data: { ok: false, error: 'invalid_agent_request' }, status: 400 };
  if (!customerName) return { data: { ok: false, error: 'agent_customer_name_required' }, status: 400 };
  const lockKey = 'agent_create_lock:' + owner;
  if (AGENT_CREATE_MUTEX.has(owner)) return { data: { ok: false, error: 'agent_creation_processing' }, status: 409 };
  const mutexToken = {};
  AGENT_CREATE_MUTEX.set(owner, mutexToken);
  const requestKey = 'agent_create_request:' + owner + ':' + requestId;
  let created = null, sid = '', savedSub = false, accountingCommitted = false, price = 0;
  let lockOwned = false, requestStarted = false;
  try {
    const held = await kvGet(env, lockKey, null);
    if (held && Date.now() - Number(held.started_at || 0) < 120000) return { data: { ok: false, error: 'agent_creation_processing' }, status: 409 };
    await kvPut(env, lockKey, { started_at: Date.now(), request_id: requestId }, 150);
    lockOwned = true;
    const previous = await kvGet(env, requestKey, null);
    if (previous && previous.state === 'done' && previous.sid) {
      const existingSub = await getSub(env, previous.sid);
      if (!existingSub || String(existingSub.agent_id || '') !== owner) return { data: { ok: false, error: 'agent_request_result_unavailable' }, status: 409 };
      const currentAgent = await getAgent(env, owner);
      return { data: { ok: true, duplicate: true, agent: miniAppAgentView(currentAgent, await getUser(env, owner)), subscription: await miniAppAgentSubscriptionView(env, existingSub) }, status: 200 };
    }
    if (previous && previous.state === 'processing') {
      return { data: { ok: false, error: 'agent_creation_processing' }, status: 409 };
    }
    const agent = await getAgent(env, owner);
    if (!agent || !isRecordEnabled(agent)) return { data: { ok: false, error: 'agent_inactive' }, status: 403 };
    const quota = Math.max(0, Math.floor(Number(agent.quota_remaining || 0)));
    if (quota < 1) return { data: { ok: false, error: 'agent_quota_exhausted' }, status: 409 };
    const [plans, panels] = await Promise.all([getPlans(env), getPanels(env)]);
    const plan = plans[planId];
    const panel = panels[panelId];
    if (!isRecordEnabled(plan) || !isRecordEnabled(panel)) return { data: { ok: false, error: 'agent_product_unavailable' }, status: 404 };
    if (!planAssignedToPanel(plan, panel.id || panelId)) return { data: { ok: false, error: 'agent_plan_panel_mismatch' }, status: 400 };
    price = await miniAppAgentPlanPrice(agent, Object.assign({}, plan, { id: String(plan.id || planId) }));
    if (!price) return { data: { ok: false, error: 'invalid_agent_price' }, status: 409 };
    if (Number(agent.balance || 0) < price) return { data: { ok: false, error: 'agent_balance_insufficient', balance: Number(agent.balance || 0), price: price }, status: 409 };
    if (!panel.api_base || !panel.api_key || !panel.user_base) return { data: { ok: false, error: 'agent_panel_unavailable' }, status: 503 };
    requestStarted = true;
    await kvPut(env, requestKey, { state: 'processing', created_at: Date.now() }, 86400);
    const panelUserName = ('a' + owner.slice(-8) + '_' + uid(8)).toLowerCase().slice(0, 32);
    created = await hCreateUser(panel, {
      name: panelUserName, gb: plan.gb, days: plan.days,
      comment: ('Agent ' + owner + ' | ' + customerName + ' | ' + String(plan.title || planId)).slice(0, 240)
    });
    if (!created || !created.uuid) throw new Error('panel_user_missing_uuid');
    sid = uid(10);
    const now = Date.now();
    const sub = {
      sid: sid, uuid: String(created.uuid), panel_id: String(panel.id || panelId), plan_id: String(plan.id || planId),
      tg_id: '', agent_id: owner, customer_name: customerName, panel_user_name: panelUserName,
      plan_name: String(plan.title || ''), panel_name: String(panel.name || ''), agent_price: price,
      kind: 'agent_subscription', order_id: null, created_at: now, reminded: '', expire_noticed: false
    };
    await saveSub(env, sub);
    savedSub = true;
    const indexed = await putIndexSafely(env, 'agent_sub_idx:' + owner + ':' + reverseIndexTime(now) + ':' + sid, { sid: sid, created_at: now });
    if (!indexed) throw new Error('agent_subscription_index_failed');
    agent.balance = Number(agent.balance || 0) - price;
    agent.quota_remaining = quota - 1;
    agent.total_created = Math.max(0, Math.floor(Number(agent.total_created || 0))) + 1;
    await saveAgent(env, agent);
    accountingCommitted = true;
    await recordAgentLedger(env, owner, {
      id: 'purchase-' + sid, type: 'subscription_created', direction: 'out', amount: price,
      balance_after: agent.balance, quota_after: agent.quota_remaining,
      plan_id: String(plan.id || planId), subscription_sid: sid,
      description: 'ساخت اشتراک برای ' + customerName, actor_id: owner
    });
    await kvPut(env, requestKey, { state: 'done', sid: sid, created_at: now }, 86400);
    const freshAgent = await getAgent(env, owner) || agent;
    return { data: { ok: true, agent: miniAppAgentView(freshAgent, await getUser(env, owner)), subscription: await miniAppAgentSubscriptionView(env, sub, plans, panels) }, status: 200 };
  } catch (e) {
    if (!lockOwned) return { data: { ok: false, error: 'agent_create_lock_unavailable' }, status: 503 };
    if (savedSub && sid) await kvDel(env, 's:' + sid);
    if (created && created.uuid) {
      try {
        const panels = await getPanels(env);
        const saved = savedSub && sid ? await kvGet(env, 's:' + sid, null) : null;
        const panelIdToDelete = saved && saved.panel_id ? saved.panel_id : String(data.panel_id || '');
        const panel = panels[panelIdToDelete];
        if (panel) await hDeleteUser(panel, created.uuid);
      } catch (cleanupError) {}
    }
    if (accountingCommitted) {
      try {
        const agent = await getAgent(env, owner);
        if (agent) {
          agent.balance = Number(agent.balance || 0) + price;
          agent.quota_remaining = Math.max(0, Math.floor(Number(agent.quota_remaining || 0))) + 1;
          agent.total_created = Math.max(0, Math.floor(Number(agent.total_created || 0)) - 1);
          await saveAgent(env, agent);
          await recordAgentLedger(env, owner, {
            id: 'refund-' + sid, type: 'creation_rollback', direction: 'in', amount: price,
            balance_after: agent.balance, quota_after: agent.quota_remaining,
            subscription_sid: sid, description: 'برگشت خودکار هزینهٔ ساخت ناموفق'
          });
        }
      } catch (rollbackError) {}
    }
    if (requestStarted) await kvDel(env, requestKey);
    try { await notifyAdmins(env, '⚠️ ساخت اشتراک نماینده ناموفق شد.\nنماینده: <code>' + owner + '</code>\nشناسهٔ درخواست: <code>' + requestId + '</code>\nخطا: <code>' + esc(String((e && e.message) || e).slice(0, 240)) + '</code>'); } catch (notifyError) {}
    return { data: { ok: false, error: 'agent_create_failed' }, status: 502 };
  } finally {
    if (lockOwned) await kvDel(env, lockKey);
    if (AGENT_CREATE_MUTEX.get(owner) === mutexToken) AGENT_CREATE_MUTEX.delete(owner);
  }
}

async function miniAppApi(request, env, url) {
  if (!['GET', 'POST'].includes(request.method)) return miniAppJson({ ok: false, error: 'method_not_allowed' }, 405);
  if (!env.DB) return miniAppJson({ ok: false, error: 'database_not_configured' }, 503);
  const identity = await miniAppIdentity(request, env);
  if (!identity.user) return miniAppJson({ ok: false, error: identity.error }, identity.status);
  const user = await ensureUser(env, identity.user);
  if (user.referral_join_eligible === true && user.referral_join_rewarded !== true) await ensureReferralJoinAward(env, user);
  const admin = isAdmin(env, identity.user.id);
  const agentRecord = admin ? null : await getAgent(env, user.tg_id);
  const agentRole = !!agentRecord;
  if (user.banned && admin) { user.banned = false; await saveUser(env, user); }
  if (user.banned && !admin) return miniAppJson({ ok: false, error: 'account_blocked' }, 403);
  const path = url.pathname;
  if (path === '/api/miniapp/bootstrap') {
    await recordCustomerActivity(env, user.tg_id, 'miniapp_open');
    const cfg = await getCfg(env);
    return miniAppJson({
      ok: true, version: VERSION, role: admin ? 'admin' : agentRole ? 'agent' : 'customer',
      profile: { id: String(user.tg_id), first_name: String(user.first_name || ''), username: String(user.username || '') },
      bot_username: String(cfg.bot_username || ''), support: String(cfg.support || '')
    }, 200);
  }
  if (path.startsWith('/api/miniapp/agent/')) {
    if (!agentRole) return miniAppJson({ ok: false, error: 'agent_required' }, 403);
    if (path === '/api/miniapp/agent/overview' && request.method === 'GET') {
      const overview = await miniAppAgentOverview(env, agentRecord, user);
      if (!isRecordEnabled(agentRecord)) { overview.products = []; overview.disabled = true; }
      return miniAppJson(overview, 200);
    }
    if (path === '/api/miniapp/agent/subscriptions' && request.method === 'POST') {
      if (!isRecordEnabled(agentRecord)) return miniAppJson({ ok: false, error: 'agent_inactive' }, 403);
      let body;
      try { body = await request.json(); }
      catch (e) { return miniAppJson({ ok: false, error: 'invalid_json' }, 400); }
      const result = await miniAppAgentCreateSubscription(env, user.tg_id, body);
      return miniAppJson(result.data, result.status);
    }
    return miniAppJson({ ok: false, error: 'not_found' }, 404);
  }
  if (path === '/api/miniapp/customer' && request.method === 'GET') {
    return miniAppJson(await miniAppCustomerData(env, user), 200);
  }
  if (path === '/api/miniapp/referrals/redeem') {
    if (request.method !== 'POST') return miniAppJson({ ok: false, error: 'method_not_allowed' }, 405);
    const result = await redeemReferralPoints(env, user);
    return miniAppJson(result.data, result.status);
  }
  if (path === '/api/miniapp/referrals/free-reward') {
    if (request.method !== 'POST') return miniAppJson({ ok: false, error: 'method_not_allowed' }, 405);
    const result = await issueReferralFreeSubscription(env, user, 'miniapp');
    const status = result.ok ? 200 : ({ referral_reward_panel_unavailable: 503, referral_reward_creation_failed: 502 }[result.error] || 409);
    return miniAppJson(result, status);
  }
  if (path === '/api/miniapp/free-subscription') {
    if (request.method !== 'POST') return miniAppJson({ ok: false, error: 'method_not_allowed' }, 405);
    const result = await issueFreeSubscription(env, user, 'miniapp');
    const status = result.ok ? 200 : ({
      free_subscription_panel_unavailable: 503,
      free_subscription_creation_failed: 502
    }[result.error] || 409);
    return miniAppJson(result, status);
  }
  if (path === '/api/miniapp/checkout') {
    if (request.method !== 'POST') return miniAppJson({ ok: false, error: 'method_not_allowed' }, 405);
    let body;
    try { body = await request.json(); }
    catch (e) { return miniAppJson({ ok: false, error: 'invalid_json' }, 400); }
    try {
      const result = await miniAppCreateCheckout(env, user, body);
      return miniAppJson(result.data, result.status);
    } catch (e) {
      return miniAppJson({ ok: false, error: 'checkout_failed' }, 500);
    }
  }
  const receiptMatch = path.match(/^\/api\/miniapp\/orders\/([A-Za-z0-9_-]{4,40})\/receipt$/);
  if (receiptMatch) {
    if (request.method !== 'POST') return miniAppJson({ ok: false, error: 'method_not_allowed' }, 405);
    try {
      const result = await miniAppSubmitReceipt(request, env, user, receiptMatch[1]);
      return miniAppJson(result.data, result.status);
    } catch (e) {
      return miniAppJson({ ok: false, error: 'receipt_submit_failed' }, 500);
    }
  }
  const orderMatch = path.match(/^\/api\/miniapp\/orders\/([A-Za-z0-9_-]{4,40})$/);
  if (orderMatch) {
    if (request.method !== 'GET') return miniAppJson({ ok: false, error: 'method_not_allowed' }, 405);
    const result = await miniAppOrderStatus(env, user, orderMatch[1]);
    return miniAppJson(result.data, result.status);
  }
  const customerSubQrMatch = path.match(/^\/api\/miniapp\/subscriptions\/([A-Za-z0-9_-]{4,40})\/qr$/);
  if (customerSubQrMatch) {
    if (request.method !== 'GET') return miniAppJson({ ok: false, error: 'method_not_allowed' }, 405);
    const sub = await getSub(env, customerSubQrMatch[1]);
    if (!sub || String(sub.tg_id) !== String(user.tg_id)) return miniAppJson({ ok: false, error: 'subscription_not_found' }, 404);
    const delivery = await miniAppSubscriptionDelivery(env, sub);
    if (!delivery) return miniAppJson({ ok: false, error: 'subscription_link_unavailable' }, 404);
    return miniAppJson({ ok: true, delivery: delivery }, 200);
  }
  const customerSubMatch = path.match(/^\/api\/miniapp\/subscriptions\/([A-Za-z0-9_-]{4,40})$/);
  if (customerSubMatch) {
    if (request.method !== 'POST') return miniAppJson({ ok: false, error: 'method_not_allowed' }, 405);
    let body;
    try { body = await request.json(); }
    catch (e) { return miniAppJson({ ok: false, error: 'invalid_json' }, 400); }
    if (!body || body.action !== 'delete') return miniAppJson({ ok: false, error: 'invalid_subscription_action' }, 400);
    const result = await deleteCustomerSubscription(env, user.tg_id, customerSubMatch[1]);
    return miniAppJson({ ok: result.ok, error: result.ok ? undefined : result.error }, result.status);
  }
  if (path.startsWith('/api/miniapp/admin/')) {
    if (!admin) return miniAppJson({ ok: false, error: 'admin_required' }, 403);
    const readBody = async () => {
      try { return await request.json(); }
      catch (e) { return null; }
    };
    if (path === '/api/miniapp/admin/agents') {
      if (request.method === 'GET') return miniAppJson(await miniAppAdminAgents(env, url.searchParams.get('q') || ''), 200);
      if (request.method === 'POST') {
        const body = await readBody();
        if (!body) return miniAppJson({ ok: false, error: 'invalid_json' }, 400);
        const result = await miniAppAdminPromoteAgent(env, identity.user.id, body);
        return miniAppJson(result.data, result.status);
      }
      return miniAppJson({ ok: false, error: 'method_not_allowed' }, 405);
    }
    if (path === '/api/miniapp/admin/agents/invites') {
      if (request.method === 'GET') return miniAppJson(await miniAppAdminAgentInviteList(env), 200);
      if (request.method === 'POST') {
        const body = await readBody();
        if (!body) return miniAppJson({ ok: false, error: 'invalid_json' }, 400);
        const result = await miniAppAdminAgentInvites(env, identity.user.id, body);
        return miniAppJson(result.data, result.status);
      }
      return miniAppJson({ ok: false, error: 'method_not_allowed' }, 405);
    }
    const adminAgentMatch = path.match(/^\/api\/miniapp\/admin\/agents\/([0-9]{1,20})$/);
    if (adminAgentMatch) {
      if (request.method === 'GET') {
        const result = await miniAppAdminAgentDetail(env, adminAgentMatch[1]);
        return miniAppJson(result, result.ok ? 200 : 404);
      }
      if (request.method === 'POST') {
        const body = await readBody();
        if (!body) return miniAppJson({ ok: false, error: 'invalid_json' }, 400);
        const result = await miniAppAdminAgentAction(env, identity.user.id, adminAgentMatch[1], body);
        return miniAppJson(result.data, result.status);
      }
      return miniAppJson({ ok: false, error: 'method_not_allowed' }, 405);
    }
    if (path === '/api/miniapp/admin/backup-link') {
      if (request.method !== 'GET') return miniAppJson({ ok: false, error: 'method_not_allowed' }, 405);
      const token = uid(48);
      const filename = 'tiznetvpn-kv-backup.json.gz';
      await kvPut(env, 'system:kv_backup_download:' + token, {
        admin_id: String(identity.user.id), created_at: Date.now(), expires_at: Date.now() + 5 * 60 * 1000, filename: filename
      }, 300);
      const downloadUrl = new URL('/api/miniapp/admin/backup-download?token=' + encodeURIComponent(token), url.origin).toString();
      return miniAppJson({ ok: true, url: downloadUrl, file_name: filename, expires_in: 300 }, 200);
    }
    if (path === '/api/miniapp/admin/backup') {
      if (request.method !== 'GET') return miniAppJson({ ok: false, error: 'method_not_allowed' }, 405);
      const activeRestore = await kvGet(env, KV_RESTORE_LOCK_KEY, null);
      if (activeRestore && Date.now() - Number(activeRestore.started_at || 0) < 30 * 60 * 1000) return miniAppJson({ ok: false, error: 'restore_busy' }, 409);
      const activeBackup = await kvGet(env, KV_BACKUP_LOCK_KEY, null);
      if (activeBackup && Date.now() - Number(activeBackup.started_at || 0) < 30 * 60 * 1000) return miniAppJson({ ok: false, error: 'backup_busy' }, 409);
      await kvPut(env, KV_BACKUP_LOCK_KEY, { started_at: Date.now(), admin_id: String(identity.user.id), manual: true }, 1800);
      try {
        const backup = await createKvBackupFile(env, Date.now(), MAX_KV_RESTORE_UPLOAD_BYTES);
        return new Response(backup.blob, { status: 200, headers: {
          'Content-Type': 'application/gzip',
          'Content-Disposition': 'attachment; filename="' + backup.filename + '"',
          'Content-Length': String(backup.blob.size),
          'Cache-Control': 'no-store, max-age=0',
          'X-Content-Type-Options': 'nosniff'
        }});
      } catch (e) {
        const tooLarge = String((e && e.message) || e) === 'kv_backup_exceeds_size_limit';
        return miniAppJson({ ok: false, error: tooLarge ? 'backup_too_large' : 'backup_create_failed' }, tooLarge ? 413 : 500);
      } finally { await kvDel(env, KV_BACKUP_LOCK_KEY); }
    }
    if (path === '/api/miniapp/admin/restore') {
      if (request.method !== 'POST') return miniAppJson({ ok: false, error: 'method_not_allowed' }, 405);
      const result = await restoreKvFromRequest(request, env, identity.user);
      return miniAppJson(result.data, result.status);
    }
    if (path === '/api/miniapp/admin/summary' && request.method === 'GET') {
      const days = miniAppPeriod(url.searchParams.get('days'), 30);
      return miniAppJson(await miniAppAdminSummary(env, days), 200);
    }
    if (path === '/api/miniapp/admin/orders' && request.method === 'GET') {
      const daysRaw = url.searchParams.get('days');
      const days = daysRaw === '0' || daysRaw === 'all' ? 0 : miniAppPeriod(daysRaw, 30);
      const result = await miniAppOrderRows(env, {
        q: url.searchParams.get('q') || '', type: url.searchParams.get('type') || 'all',
        status: url.searchParams.get('status') || 'all', method: url.searchParams.get('method') || 'all',
        plan_id: url.searchParams.get('plan_id') || '', panel_id: url.searchParams.get('panel_id') || '',
        days: days, limit: url.searchParams.get('limit') || 50, index_limit: 220
      });
      return miniAppJson(Object.assign({ ok: true }, result), 200);
    }
    const receiptMatch = path.match(/^\/api\/miniapp\/admin\/orders\/([A-Za-z0-9_-]{4,40})\/receipt$/);
    if (receiptMatch && request.method === 'GET') {
      const order = await getOrder(env, receiptMatch[1]);
      if (!order) return miniAppJson({ ok: false, error: 'order_not_found' }, 404);
      if (!order.receipt_file_id) return miniAppJson({ ok: false, error: 'receipt_not_found' }, 404);
      try {
        const file = await tg(env, 'getFile', { file_id: order.receipt_file_id });
        const filePath = String(file && file.file_path || '');
        if (!/^(photos|documents)\/[A-Za-z0-9_./-]+$/.test(filePath) || filePath.includes('..')) throw new Error('Invalid Telegram file path');
        const fileUrl = 'https://api.telegram.org/file/bot' + env.BOT_TOKEN + '/' + filePath.split('/').map(encodeURIComponent).join('/');
        const remote = await fetch(fileUrl);
        if (!remote.ok) throw new Error('Telegram file download failed');
        const ext = filePath.toLowerCase().split('.').pop();
        const contentType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
        return new Response(remote.body, { status: 200, headers: {
          'Content-Type': contentType, 'Cache-Control': 'no-store, max-age=0',
          'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline'
        }});
      } catch (e) { return miniAppJson({ ok: false, error: 'receipt_fetch_failed' }, 502); }
    }
    const adminOrderMatch = path.match(/^\/api\/miniapp\/admin\/orders\/([A-Za-z0-9_-]{4,40})$/);
    if (adminOrderMatch) {
      const order = await getOrder(env, adminOrderMatch[1]);
      if (!order) return miniAppJson({ ok: false, error: 'order_not_found' }, 404);
      if (request.method === 'GET') return miniAppJson({ ok: true, order: await miniAppAdminOrderView(env, order) }, 200);
      if (request.method === 'POST') {
        const body = await readBody();
        if (!body) return miniAppJson({ ok: false, error: 'invalid_json' }, 400);
        const result = await miniAppAdminOrderAction(env, identity.user.id, adminOrderMatch[1], body);
        return miniAppJson(result.data, result.status);
      }
      return miniAppJson({ ok: false, error: 'method_not_allowed' }, 405);
    }
    if (path === '/api/miniapp/admin/customers' && request.method === 'GET') {
      return miniAppJson(await miniAppAdminCustomers(env, url.searchParams.get('q') || '', url.searchParams.get('limit') || 50), 200);
    }
    const customerMatch = path.match(/^\/api\/miniapp\/admin\/customers\/([0-9]{1,20})$/);
    if (customerMatch && request.method === 'GET') {
      const result = await miniAppAdminCustomerDetail(env, customerMatch[1]);
      return miniAppJson(result, result.ok ? 200 : 404);
    }
    if (customerMatch && request.method === 'POST') {
      const body = await readBody();
      if (!body) return miniAppJson({ ok: false, error: 'invalid_json' }, 400);
      const result = await miniAppAdminCustomerAction(env, identity.user.id, customerMatch[1], body);
      return miniAppJson(result.data, result.status);
    }
    if (path === '/api/miniapp/admin/settings') {
      if (request.method === 'GET') {
        const view = miniAppAdminSettingsView(await getCfg(env), env);
        const panels = await getPanels(env);
        view.panels = Object.entries(panels || {}).map(([id, panel]) => ({ id: String(panel.id || id), name: String(panel.name || ''), enabled: isRecordEnabled(panel) })).sort((a,b) => a.name.localeCompare(b.name, 'fa'));
        return miniAppJson(view, 200);
      }
      if (request.method === 'POST') {
        const body = await readBody();
        if (!body) return miniAppJson({ ok: false, error: 'invalid_json' }, 400);
        const result = await miniAppAdminUpdateSettings(env, body);
        return miniAppJson(result.data, result.status);
      }
      return miniAppJson({ ok: false, error: 'method_not_allowed' }, 405);
    }
    if (path === '/api/miniapp/admin/panels') {
      if (request.method === 'GET') return miniAppJson(await miniAppAdminPanelList(env), 200);
      if (request.method === 'POST') {
        const body = await readBody();
        if (!body) return miniAppJson({ ok: false, error: 'invalid_json' }, 400);
        const result = await miniAppAdminPanelAction(env, body);
        return miniAppJson(result.data, result.status);
      }
      return miniAppJson({ ok: false, error: 'method_not_allowed' }, 405);
    }
    if (path === '/api/miniapp/admin/plans/manage' && request.method === 'GET') {
      return miniAppJson(await miniAppAdminManagedPlans(env), 200);
    }
    if (path === '/api/miniapp/admin/plans' && request.method === 'POST') {
      const body = await readBody();
      if (!body) return miniAppJson({ ok: false, error: 'invalid_json' }, 400);
      const result = await miniAppAdminPlanAction(env, body);
      return miniAppJson(result.data, result.status);
    }
    if (path === '/api/miniapp/admin/plans' && request.method === 'GET') {
      const days = miniAppPeriod(url.searchParams.get('days'), 30);
      return miniAppJson(await miniAppAdminPlans(env, days), 200);
    }
    if (path === '/api/miniapp/admin/withdrawals' && request.method === 'GET') {
      return miniAppJson(await miniAppAdminWithdrawals(env), 200);
    }
    const withdrawalMatch = path.match(/^\/api\/miniapp\/admin\/withdrawals\/([A-Za-z0-9_-]{4,40})$/);
    if (withdrawalMatch && request.method === 'POST') {
      const body = await readBody();
      if (!body) return miniAppJson({ ok: false, error: 'invalid_json' }, 400);
      const result = await miniAppAdminWithdrawalAction(env, identity.user.id, withdrawalMatch[1], body);
      return miniAppJson(result.data, result.status);
    }
    return miniAppJson({ ok: false, error: 'not_found' }, 404);
  }
  return miniAppJson({ ok: false, error: 'not_found' }, 404);
}

async function serveMiniAppAsset(env, request, useIndexFile) {
  if (!env.ASSETS || typeof env.ASSETS.fetch !== 'function') {
    return new Response('Mini App assets are not configured. Deploy with Wrangler [assets] binding.', {
      status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }
  const target = new URL(useIndexFile ? '/miniapp.html' : request.url, request.url);
  const assetRequest = new Request(target.toString(), { method: 'GET', headers: { Accept: 'text/html' } });
  const response = await env.ASSETS.fetch(assetRequest);
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store, max-age=0');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: headers });
}


function constantTimeEqual(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function readShetabPayload(request) {
  const contentType = (request.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    const out = {};
    for (const [k, v] of form.entries()) out[k] = String(v);
    return out;
  }
  const text = await request.text();
  if (contentType.includes('application/json')) return JSON.parse(text || '{}');
  if (contentType.includes('application/x-www-form-urlencoded') || !contentType) {
    return Object.fromEntries(new URLSearchParams(text));
  }
  try { return JSON.parse(text || '{}'); }
  catch (e) { return Object.fromEntries(new URLSearchParams(text)); }
}

async function findShetabOrderByAmount(env, amount) {
  const pending = await kvGet(env, 'pend', []);
  const matches = [];
  for (const id of pending) {
    const o = await getOrder(env, id);
    if (o && o.status === 'pending' && o.payment_method === 'shetab' && Number(o.pay_amount) === Number(amount)) matches.push(o);
  }
  if (matches.length) return matches;
  const reservation = await kvGet(env, 'shetab_amt:' + amount, null);
  if (!reservation || !reservation.order_id) return [];
  const o = await getOrder(env, reservation.order_id);
  if (o && o.payment_method === 'shetab' && Number(o.pay_amount) === Number(amount)) return [o];
  return [];
}

async function shetabConfirm(request, env, successMessage) {
  if (request.method !== 'POST') return shetabJson({ success: false, message: 'POST required' }, 405);
  if (!env.SHETAB_API_SECRET) return shetabJson({ success: false, message: 'Endpoint is not configured' }, 503);
  const auth = request.headers.get('authorization') || request.headers.get('x-api-key') || '';
  const token = auth.replace(/^\s*Bearer\s+/i, '').trim();
  if (!constantTimeEqual(token, env.SHETAB_API_SECRET)) return shetabJson({ success: false, message: 'Unauthorized' }, 401);

  let payload;
  try { payload = await readShetabPayload(request); }
  catch (e) { return shetabJson({ success: false, message: 'Invalid payload' }, 400); }
  const receivedAmount = parseMoney(payload && payload.amount);
  if (!Number.isSafeInteger(receivedAmount) || receivedAmount <= 0) {
    return shetabJson({ success: false, message: 'A positive numeric amount is required' }, 400);
  }
  const recipeRaw = payload.recipeId || payload.recipe_id || payload.reference || payload.transaction_id || payload.ref || '';
  const recipeId = cleanText(recipeRaw).slice(0, 100);
  const candidates = [receivedAmount];
  // نسخه‌های قدیمی بعضی اپ‌ها مبلغ را ریال می‌فرستند؛ پس از تلاش دقیق به تومان تبدیل می‌کنیم.
  if (receivedAmount % 10 === 0) candidates.push(receivedAmount / 10);
  let order = null;
  let matchedAmount = receivedAmount;
  for (const amount of candidates) {
    const matches = await findShetabOrderByAmount(env, amount);
    if (matches.length > 1) return shetabJson({ success: false, message: 'Ambiguous payment amount; manual review required' }, 409);
    if (matches.length === 1) { order = matches[0]; matchedAmount = amount; break; }
  }
  if (!order) return shetabJson({ success: false, message: 'No pending order matches this amount' }, 404);

  if (order.payment_status === 'paid') {
    if (recipeId && order.payment_ref && recipeId !== order.payment_ref) {
      for (const adminId of adminIds(env)) {
        try { await msg(env, adminId, '⚠️ <b>تراکنش تکراری/اضافی احتمالی</b>\nمبلغ ' + fmtToman(matchedAmount) + ' برای سفارش <code>' + order.id + '</code> قبلاً ثبت شده؛ کد پیگیری جدید: <code>' + esc(recipeId) + '</code>. لطفاً رسیدگی کنید.'); } catch (e) {}
      }
    }
    return shetabJson({ success: true, message: successMessage, already_processed: true, order_id: order.id }, 200);
  }
  if (order.status !== 'pending') return shetabJson({ success: false, message: 'Order is no longer pending' }, 409);

  order.payment_status = 'paid';
  order.payment_received_at = Date.now();
  order.payment_ref = recipeId || null;
  order.reported_amount = receivedAmount;
  await saveOrder(env, order);
  await kvPut(env, 'shetab_amt:' + order.pay_amount, { order_id: order.id, paid_at: Date.now() }, SHETAB_AMOUNT_TTL);

  let fulfilled = true;
  let fulfillmentError = '';
  try { await approveOrder(env, order); }
  catch (e) {
    fulfilled = false;
    fulfillmentError = String((e && e.message) || e).slice(0, 500);
    const latest = await getOrder(env, order.id) || order;
    latest.payment_status = 'paid';
    latest.fulfillment_error = fulfillmentError;
    if (latest.status === 'pending') await saveOrder(env, latest);
    for (const adminId of adminIds(env)) {
      try {
        await msg(env, adminId,
          '⚠️ <b>پرداخت خودکار تأیید شد اما تحویل با خطا روبه‌رو شد.</b>\n🧾 سفارش: <code>' + order.id + '</code>\n💵 مبلغ پلن: ' + fmtToman(order.amount) + '\nخطا: <code>' + esc(fulfillmentError) + '</code>',
          KB([[BTN('🔍 مشاهده سفارش', 'a_ord:' + order.id)]]));
      } catch (e2) {}
    }
    try {
      await msg(env, order.tg_id,
        '✅ پرداخت شما شناسایی شد، اما ساخت/تمدید سرویس با خطا روبه‌رو شد. ادمین پیگیری می‌کند؛ لطفاً پرداخت دیگری انجام ندهید.\n🧾 سفارش: <code>' + order.id + '</code>',
        KB([[BTN('📞 پشتیبانی', 'sup')]]));
    } catch (e2) {}
  }
  if (fulfilled) {
    for (const adminId of adminIds(env)) {
      try { await msg(env, adminId, '✅ پرداخت خودکار و تحویل سفارش <code>' + order.id + '</code> انجام شد. مبلغ پلن: ' + fmtToman(order.amount) + '.'); } catch (e) {}
    }
  }
  // پس از ثبت پرداخت، پاسخ موفق می‌دهیم تا اپ با retry باعث تحویل دوباره نشود.
  return shetabJson({ success: true, message: successMessage, payment_confirmed: true, fulfilled: fulfilled, order_id: order.id }, 200);
}

/* ============================ ورودی ورکر ============================ */

async function manualBackupDownloadResponse(request, env, url) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': 'https://web.telegram.org',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
    'Cache-Control': 'no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff'
  };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== 'GET') return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  const token = String(url.searchParams.get('token') || '');
  if (!/^[A-HJ-NP-Z2-9]{40,60}$/.test(token)) return new Response('Invalid or expired download link', { status: 404, headers: corsHeaders });
  if (!env.DB) return new Response('Backup storage is unavailable', { status: 503, headers: corsHeaders });
  const tokenKey = 'system:kv_backup_download:' + token;
  const record = await kvGet(env, tokenKey, null);
  if (!record || Number(record.expires_at || 0) <= Date.now()) {
    await kvDel(env, tokenKey);
    return new Response('Invalid or expired download link', { status: 410, headers: corsHeaders });
  }
  const inflightKey = 'system:kv_backup_download_inflight:' + token;
  const inflight = await kvGet(env, inflightKey, null);
  if (inflight && Date.now() - Number(inflight.started_at || 0) < 5 * 60 * 1000) return new Response('This download link is already in use', { status: 409, headers: corsHeaders });
  const activeRestore = await kvGet(env, KV_RESTORE_LOCK_KEY, null);
  if (activeRestore && Date.now() - Number(activeRestore.started_at || 0) < 30 * 60 * 1000) return new Response('A restore is in progress', { status: 409, headers: corsHeaders });
  const activeBackup = await kvGet(env, KV_BACKUP_LOCK_KEY, null);
  if (activeBackup && Date.now() - Number(activeBackup.started_at || 0) < 30 * 60 * 1000) return new Response('Another backup is in progress', { status: 409, headers: corsHeaders });
  await kvPut(env, inflightKey, { started_at: Date.now() }, 300);
  await kvPut(env, KV_BACKUP_LOCK_KEY, { started_at: Date.now(), admin_id: String(record.admin_id || ''), manual: true }, 1800);
  try {
    const backup = await createKvBackupFile(env, Date.now(), MAX_KV_RESTORE_UPLOAD_BYTES);
    await kvDel(env, tokenKey);
    const filename = String(backup.filename || record.filename || 'tiznetvpn-kv-backup.json.gz').replace(/[\\"\r\n]/g, '_');
    const headers = Object.assign({}, corsHeaders, {
      'Content-Type': 'application/gzip',
      'Content-Disposition': 'attachment; filename="' + filename + '"',
      'Content-Length': String(backup.blob.size)
    });
    return new Response(backup.blob, { status: 200, headers: headers });
  } catch (e) {
    const tooLarge = String((e && e.message) || e) === 'kv_backup_exceeds_size_limit';
    const status = tooLarge ? 413 : 500;
    const body = tooLarge ? 'Backup exceeds the 45 MiB size limit' : 'Backup creation failed';
    return new Response(body, { status: status, headers: Object.assign({}, corsHeaders, { 'Content-Type': 'text/plain; charset=utf-8' }) });
  } finally {
    await kvDel(env, inflightKey);
    await kvDel(env, KV_BACKUP_LOCK_KEY);
  }
}

async function fetchHandler(request, env) {
  const url = new URL(request.url);

  if (request.method === 'GET' && (url.pathname === '/miniapp' || url.pathname === '/miniapp/')) {
    return await serveMiniAppAsset(env, request, true);
  }
  if (request.method === 'GET' && url.pathname === '/miniapp.html') {
    return await serveMiniAppAsset(env, request, false);
  }
  if (url.pathname === '/api/miniapp/admin/backup-download') {
    return await manualBackupDownloadResponse(request, env, url);
  }
  if (url.pathname.startsWith('/api/miniapp/')) {
    return await miniAppApi(request, env, url);
  }
  if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '')) {
    return new Response('🤖 TiznetVPN | فروشگاه اشتراک v' + VERSION + ' — OK\n', {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }

  // API سازگار با Shetab Verification: مسیر قدیمی پلاگین WordPress و مسیر Laravel/PowerPs.
  const shetabPath = url.pathname.replace(/\/+$/, '');
  if (shetabPath === '/wp-json/webdide-cv/v1/confirm' || shetabPath === '/api/shetab-verify') {
    // GET یک health-check بدون اثر مالی است؛ تأیید واقعی واریز فقط با POST انجام می‌شود.
    if (request.method === 'GET') {
      if (!env.SHETAB_API_SECRET) return shetabJson({ success: false, message: 'Endpoint is not configured' }, 503);
      const authorization = request.headers.get('authorization');
      const apiKey = request.headers.get('x-api-key');
      const hasCredential = authorization !== null || apiKey !== null;
      const auth = authorization || apiKey || '';
      const token = auth.replace(/^\s*Bearer\s+/i, '').trim();
      if (hasCredential && !constantTimeEqual(token, env.SHETAB_API_SECRET)) return shetabJson({ success: false, message: 'Unauthorized' }, 401);
      return shetabJson({ success: true, message: 'Shetab endpoint is online', version: VERSION }, 200);
    }
    if (request.method !== 'POST') return shetabJson({ success: false, message: 'POST required' }, 405);
    const successMessage = shetabPath === '/wp-json/webdide-cv/v1/confirm' ? 'Payment confirmed successfully.' : 'Shetab verify is verified';
    return await shetabConfirm(request, env, successMessage);
  }

  // وبهوک تلگرام
  if (request.method === 'POST' && url.pathname === '/webhook') {
    if (env.WEBHOOK_SECRET) {
      const got = request.headers.get('x-telegram-bot-api-secret-token') || '';
      if (got !== env.WEBHOOK_SECRET) return new Response('Forbidden', { status: 403 });
    }
    let upd = null;
    try { upd = await request.json(); } catch (e) { return new Response('bad request', { status: 400 }); }
    try {
      await handleUpdate(env, upd, url.origin);
    } catch (e) {
      // همیشه ۲۰۰ برمی‌گردانیم تا تلگرام اسپم retry نکند
      try {
        const chatId = (upd.message && upd.message.chat.id) || (upd.callback_query && upd.callback_query.from.id);
        if (chatId && upd.callback_query) {
          await ansCb(env, upd.callback_query.id, '❌ خطای داخلی، لطفاً دوباره تلاش کنید.', true);
        }
      } catch (e2) {}
    }
    return new Response('ok');
  }

  if (request.method === 'GET' && env.ASSETS && typeof env.ASSETS.fetch === 'function') {
    return await serveMiniAppAsset(env, request, false);
  }
  return new Response('Not found', { status: 404 });
}

async function readGzipBackupText(file) {
  if (!file || typeof file.stream !== 'function' || typeof DecompressionStream !== 'function') throw new Error('invalid_backup_gzip');
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (head.length !== 2 || head[0] !== 0x1f || head[1] !== 0x8b) throw new Error('invalid_backup_gzip');
  const reader = file.stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > MAX_KV_RESTORE_JSON_BYTES) {
      try { await reader.cancel(); } catch (e) {}
      throw new Error('backup_decompressed_too_large');
    }
    text += decoder.decode(part.value, { stream: true });
  }
  text += decoder.decode();
  return text;
}

function validateKvBackupSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || snapshot.format !== 'tiznetvpn-kv-backup' || Number(snapshot.schema_version) !== 1 || !Array.isArray(snapshot.entries)) {
    throw new Error('invalid_backup_format');
  }
  if (snapshot.entries.length < 1 || snapshot.entries.length > 100000 || Number(snapshot.entry_count) !== snapshot.entries.length) throw new Error('invalid_backup_entry_count');
  const encoder = new TextEncoder();
  const seen = new Set();
  const entries = [];
  for (const entry of snapshot.entries) {
    if (!entry || typeof entry !== 'object' || typeof entry.key !== 'string' || typeof entry.value !== 'string') throw new Error('invalid_backup_entry');
    const key = entry.key;
    if (!key || encoder.encode(key).byteLength > 512 || /[\u0000-\u001f\u007f]/.test(key) || seen.has(key)) throw new Error('invalid_backup_key');
    if (encoder.encode(entry.value).byteLength > 25 * 1024 * 1024) throw new Error('invalid_backup_value');
    if (entry.metadata != null && (typeof entry.metadata !== 'object' || Array.isArray(entry.metadata) || encoder.encode(JSON.stringify(entry.metadata)).byteLength > 1024)) throw new Error('invalid_backup_metadata');
    const expiration = entry.expiration == null ? null : Number(entry.expiration);
    if (expiration != null && (!Number.isFinite(expiration) || expiration <= 0)) throw new Error('invalid_backup_expiration');
    seen.add(key);
    entries.push({ key: key, value: entry.value, expiration: expiration, metadata: entry.metadata == null ? null : entry.metadata });
  }
  return { entries: entries, created_at: String(snapshot.created_at || ''), worker_version: String(snapshot.worker_version || '') };
}

async function listKvKeyNames(env) {
  const names = [];
  let cursor;
  let pages = 0;
  while (true) {
    if (++pages > 10000) throw new Error('kv_restore_pagination_limit');
    const options = { limit: 1000 };
    if (cursor) options.cursor = cursor;
    const page = await env.DB.list(options);
    for (const key of (page && Array.isArray(page.keys) ? page.keys : [])) {
      if (key && key.name != null) names.push(String(key.name));
    }
    if (!page || page.list_complete || !page.cursor) break;
    cursor = page.cursor;
  }
  return names;
}

async function replaceKvContents(env, entries, preserveKeys) {
  const preserve = new Set(preserveKeys || []);
  preserve.add(KV_RESTORE_LOCK_KEY);
  const currentKeys = await listKvKeyNames(env);
  for (let i = 0; i < currentKeys.length; i += 25) {
    await Promise.all(currentKeys.slice(i, i + 25).filter((key) => !preserve.has(key)).map((key) => env.DB.delete(key)));
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  let restored = 0;
  let skippedExpired = 0;
  const normalized = (Array.isArray(entries) ? entries : []).filter((entry) => entry && typeof entry.key === 'string' && entry.key !== KV_RESTORE_LOCK_KEY && entry.key !== KV_BACKUP_LOCK_KEY && !entry.key.startsWith('system:kv_backup_download:') && !entry.key.startsWith('system:kv_backup_download_inflight:') && !preserve.has(entry.key));
  for (let i = 0; i < normalized.length; i += 20) {
    await Promise.all(normalized.slice(i, i + 20).map(async (entry) => {
      if (entry.expiration != null && Number(entry.expiration) <= nowSeconds) { skippedExpired++; return; }
      const options = {};
      if (entry.expiration != null) options.expiration = Number(entry.expiration);
      if (entry.metadata != null) options.metadata = entry.metadata;
      await env.DB.put(entry.key, String(entry.value), Object.keys(options).length ? options : undefined);
      restored++;
    }));
  }
  return { restored: restored, skipped_expired: skippedExpired };
}

async function restoreKvFromRequest(request, env, adminUser) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_KV_RESTORE_UPLOAD_BYTES + 1024 * 1024) return { data: { ok: false, error: 'backup_too_large' }, status: 413 };
  let form;
  try { form = await request.formData(); }
  catch (e) { return { data: { ok: false, error: 'invalid_restore_upload' }, status: 400 }; }
  const file = form.get('file');
  if (!file || typeof file.stream !== 'function') return { data: { ok: false, error: 'backup_file_required' }, status: 400 };
  if (!Number(file.size) || Number(file.size) > MAX_KV_RESTORE_UPLOAD_BYTES) return { data: { ok: false, error: 'backup_too_large' }, status: 413 };
  if (String(form.get('confirm') || '') !== 'RESTORE') return { data: { ok: false, error: 'restore_confirmation_required' }, status: 400 };
  if (!env.DB || typeof env.DB.list !== 'function' || typeof env.DB.put !== 'function' || typeof env.DB.delete !== 'function') return { data: { ok: false, error: 'database_not_configured' }, status: 503 };

  const now = Date.now();
  const activeRestore = await kvGet(env, KV_RESTORE_LOCK_KEY, null);
  if (activeRestore && now - Number(activeRestore.started_at || 0) < 30 * 60 * 1000) return { data: { ok: false, error: 'restore_busy' }, status: 409 };
  const activeBackup = await kvGet(env, KV_BACKUP_LOCK_KEY, null);
  if (activeBackup && now - Number(activeBackup.started_at || 0) < 30 * 60 * 1000) return { data: { ok: false, error: 'backup_busy' }, status: 409 };
  await kvPut(env, KV_RESTORE_LOCK_KEY, { started_at: now, admin_id: String(adminUser && adminUser.id || '') }, 1800);
  const backupLockAfter = await kvGet(env, KV_BACKUP_LOCK_KEY, null);
  if (backupLockAfter && Date.now() - Number(backupLockAfter.started_at || 0) < 30 * 60 * 1000) {
    await kvDel(env, KV_RESTORE_LOCK_KEY);
    return { data: { ok: false, error: 'backup_busy' }, status: 409 };
  }

  let currentEntries = null;
  let mutationStarted = false;
  try {
    let snapshot;
    try { snapshot = validateKvBackupSnapshot(JSON.parse(await readGzipBackupText(file))); }
    catch (e) {
      const error = String((e && e.message) || e);
      return { data: { ok: false, error: error === 'backup_decompressed_too_large' ? error : 'invalid_backup_file' }, status: 400 };
    }
    const recipients = Array.from(new Set(adminIds(env)));
    const currentAdminId = String(adminUser && adminUser.id || '');
    if (!recipients.length || !currentAdminId || !recipients.includes(currentAdminId)) return { data: { ok: false, error: 'restore_admin_backup_unavailable' }, status: 503 };
    let before;
    try { before = await createKvBackupFile(env, Date.now(), MAX_KV_RESTORE_UPLOAD_BYTES, new Set([KV_RESTORE_LOCK_KEY])); }
    catch (e) { return { data: { ok: false, error: 'restore_safety_backup_failed' }, status: 503 }; }
    currentEntries = before.items;
    let currentAdminReceived = false;
    const caption = 'پشتیبان کامل KV پیش از ریستور · ' + faNum(before.entries) + ' رکورد · gzip بدون رمزگذاری؛ اطلاعات حساس داخل فایل است.';
    for (const id of recipients) {
      try {
        await sendDoc(env, id, before.filename, before.blob, caption, 'application/gzip');
        if (String(id) === currentAdminId) currentAdminReceived = true;
      } catch (e) {}
    }
    if (!currentAdminReceived) return { data: { ok: false, error: 'restore_safety_backup_delivery_failed' }, status: 503 };

    mutationStarted = true;
    let result;
    try { result = await replaceKvContents(env, snapshot.entries, new Set([KV_RESTORE_LOCK_KEY])); }
    catch (e) {
      try {
        await replaceKvContents(env, currentEntries, new Set([KV_RESTORE_LOCK_KEY]));
        mutationStarted = false;
        return { data: { ok: false, error: 'restore_failed_rolled_back' }, status: 500 };
      } catch (rollbackError) {
        try { await notifyAdmins(env, '🚨 ریستور KV شکست خورد و بازیابی خودکار کامل نشد؛ فایل پشتیبان پیش از ریستور در همین چت مدیر ارسال شده است.'); } catch (e2) {}
        return { data: { ok: false, error: 'restore_failed_rollback_failed' }, status: 500 };
      }
    }
    try { await notifyAdmins(env, '✅ ریستور KV انجام شد. رکوردهای بازگردانده‌شده: ' + faNum(result.restored) + ' · منقضی و نادیده‌گرفته‌شده: ' + faNum(result.skipped_expired) + ' · مدیر: <code>' + esc(currentAdminId) + '</code>'); } catch (e) {}
    mutationStarted = false;
    return { data: { ok: true, restored_entries: result.restored, skipped_expired: result.skipped_expired, safety_backup_sent: true }, status: 200 };
  } catch (e) {
    if (mutationStarted && currentEntries) {
      try { await replaceKvContents(env, currentEntries, new Set([KV_RESTORE_LOCK_KEY])); }
      catch (rollbackError) {
        try { await notifyAdmins(env, '🚨 ریستور KV شکست خورد و rollback خودکار نیز خطا داد؛ فایل پشتیبان پیش از ریستور در چت مدیر موجود است.'); } catch (e2) {}
        return { data: { ok: false, error: 'restore_failed_rollback_failed' }, status: 500 };
      }
    }
    return { data: { ok: false, error: 'restore_failed' }, status: 500 };
  } finally {
    await kvDel(env, KV_RESTORE_LOCK_KEY);
  }
}

async function createKvBackupFile(env, generatedAt, maxCompressedBytes, excludedKeys) {
  if (!env || !env.DB || typeof env.DB.list !== 'function' || typeof env.DB.get !== 'function') {
    throw new Error('kv_backup_binding_unavailable');
  }
  const requestedAt = Number(generatedAt);
  const createdAt = Number.isFinite(requestedAt) && requestedAt > 0 ? requestedAt : Date.now();
  const maxBytes = Number(maxCompressedBytes) > 0 ? Number(maxCompressedBytes) : 45 * 1024 * 1024;
  const excluded = new Set(excludedKeys instanceof Set ? excludedKeys : []);
  excluded.add(KV_BACKUP_LOCK_KEY);
  excluded.add(KV_RESTORE_LOCK_KEY);
  const items = [];
  let cursor;
  let pages = 0;
  while (true) {
    if (++pages > 10000) throw new Error('kv_backup_pagination_limit');
    const options = { limit: 1000 };
    if (cursor) options.cursor = cursor;
    const page = await env.DB.list(options);
    const keys = Array.isArray(page && page.keys) ? page.keys : [];
    for (let i = 0; i < keys.length; i += 40) {
      const batch = await Promise.all(keys.slice(i, i + 40).map(async (entry) => {
        const key = String(entry && entry.name || '');
        if (!key || excluded.has(key) || key.startsWith('system:kv_backup_download:') || key.startsWith('system:kv_backup_download_inflight:')) return null;
        const value = await env.DB.get(key);
        if (value === null) return null;
        return {
          key: key,
          value: String(value),
          expiration: entry.expiration == null ? null : entry.expiration,
          metadata: entry.metadata == null ? null : entry.metadata
        };
      }));
      for (const item of batch) if (item) items.push(item);
    }
    if (!page || page.list_complete || !page.cursor) break;
    cursor = page.cursor;
  }

  const snapshot = {
    format: 'tiznetvpn-kv-backup',
    schema_version: 1,
    worker_version: VERSION,
    created_at: new Date(createdAt).toISOString(),
    entry_count: items.length,
    entries: items
  };
  const json = JSON.stringify(snapshot, null, 2);
  if (typeof CompressionStream !== 'function') throw new Error('gzip_compression_unavailable');
  const compressedStream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
  const blob = await new Response(compressedStream).blob();
  if (blob.size > maxBytes) throw new Error('kv_backup_exceeds_size_limit');
  const stamp = new Date(createdAt).toISOString().replace(/[:.]/g, '-');
  return { blob: blob, filename: 'tiznetvpn-kv-backup-' + stamp + '.json.gz', entries: items.length, items: items, createdAt: createdAt };
}

async function sendKvBackup(env, scheduledTime) {
  const nowValue = Number(scheduledTime);
  const now = Number.isFinite(nowValue) && nowValue > 0 ? nowValue : Date.now();
  const restoreLock = await kvGet(env, KV_RESTORE_LOCK_KEY, null);
  if (restoreLock && now - Number(restoreLock.started_at || 0) < 30 * 60 * 1000) return { skipped: 'restore_in_progress' };
  const recipients = adminIds(env);
  if (!recipients.length) throw new Error('kv_backup_admins_unconfigured');
  const lastSent = Number(await kvGet(env, KV_BACKUP_LAST_KEY, 0) || 0);
  if (lastSent && now - lastSent < KV_BACKUP_MIN_INTERVAL_MS) return { skipped: 'already_sent' };
  const lock = await kvGet(env, KV_BACKUP_LOCK_KEY, null);
  const lockAt = Number(lock && lock.started_at || 0);
  if (lockAt && now - lockAt < 30 * 60 * 1000) return { skipped: 'already_running' };
  await kvPut(env, KV_BACKUP_LOCK_KEY, { started_at: now }, 60 * 60);
  try {
    const backup = await createKvBackupFile(env, now);
    const caption = 'بکاپ کامل KV · ' + faNum(backup.entries) + ' رکورد · فایل gzip بدون رمزگذاری. شامل اطلاعات و اعتبارنامه‌های ذخیره‌شده در KV است.';
    let delivered = 0;
    for (const id of recipients) {
      try {
        await sendDoc(env, id, backup.filename, backup.blob, caption, 'application/gzip');
        delivered++;
      } catch (e) {}
    }
    if (!delivered) throw new Error('kv_backup_delivery_failed');
    await kvPut(env, KV_BACKUP_LAST_KEY, now);
    return { delivered: delivered, entries: backup.entries, filename: backup.filename };
  } finally {
    await kvDel(env, KV_BACKUP_LOCK_KEY);
  }
}

async function scheduledHandler(event, env) {
  if (String(event && event.cron || '') === KV_BACKUP_CRON) {
    try { await sendKvBackup(env, event && event.scheduledTime); }
    catch (e) { try { await notifyAdmins(env, '⚠️ تهیه یا ارسال بکاپ KV انجام نشد. پیکربندی Admin IDs و دسترسی Telegram را بررسی کنید.'); } catch (e2) {} }
    return;
  }
  try { await cronReminders(env); } catch (e) {}
}

const APP = { fetch: fetchHandler, scheduled: scheduledHandler };
export default APP;
