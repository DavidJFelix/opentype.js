// The `sfnt` wrapper provides organization for the tables in the font.
// It is the top-level data structure in a font.
// https://www.microsoft.com/typography/OTSPEC/otff.htm
// Recommendations for creating OpenType Fonts:
// http://www.microsoft.com/typography/otspec140/recom.htm

'use strict';

var check = require('../check');
var table = require('../table');

var cmap = require('./cmap');
var cff = require('./cff');
var head = require('./head');
var hhea = require('./hhea');
var hmtx = require('./hmtx');
var maxp = require('./maxp');
var _name = require('./name');
var os2 = require('./os2');
var post = require('./post');

function log2(v) {
    return Math.log(v) / Math.log(2) | 0;
}

function computeCheckSum(bytes) {
    while (bytes.length % 4 !== 0) {
        bytes.push(0);
    }
    var sum = 0;
    for (var i = 0; i < bytes.length; i += 4) {
        sum += (bytes[i] << 24) +
               (bytes[i + 1] << 16) +
               (bytes[i + 2] << 8) +
               (bytes[i + 3]);
    }
    sum %= Math.pow(2, 32);
    return sum;
}

function makeTableRecord(tag, checkSum, offset, length) {
    return new table.Table('Table Record', [
        {name: 'tag', type: 'TAG', value: tag !== undefined ? tag : ''},
        {name: 'checkSum', type: 'ULONG', value: checkSum !== undefined ? checkSum : 0},
        {name: 'offset', type: 'ULONG', value: offset !== undefined ? offset : 0},
        {name: 'length', type: 'ULONG', value: length !== undefined ? length : 0}]);
}

function makeSfntTable(tables) {
    var sfnt =  new table.Table('sfnt', [
        {name: 'version', type: 'TAG', value: 'OTTO'},
        {name: 'numTables', type: 'USHORT', value: 0},
        {name: 'searchRange', type: 'USHORT', value: 0},
        {name: 'entrySelector', type: 'USHORT', value: 0},
        {name: 'rangeShift', type: 'USHORT', value: 0}]);
    sfnt.tables = tables;
    sfnt.numTables = tables.length;
    var highestPowerOf2 = Math.pow(2, log2(sfnt.numTables));
    sfnt.searchRange = 16 * highestPowerOf2;
    sfnt.entrySelector = log2(highestPowerOf2);
    sfnt.rangeShift = sfnt.numTables * 16 - sfnt.searchRange;

    var tableFields = [];
    var offset = sfnt.sizeOf() + (makeTableRecord().sizeOf() * sfnt.numTables);
    while (offset % 4 !== 0) {
        offset += 1;
        tableFields.push({name: 'padding', type: 'BYTE', value: 0});
    }

    for (var i = 0; i < tables.length; i += 1) {
        var t = tables[i];
        check.argument(t.tableName.length === 4, 'Table name' + t.tableName + ' is invalid.');
        var tableLength = t.sizeOf();
        var tableRecord = makeTableRecord(t.tableName, computeCheckSum(t.encode()), offset, tableLength);
        sfnt.fields.push({name: tableRecord.tag + ' Table Record', type: 'TABLE', value: tableRecord});
        tableFields.push({name: t.tableName + ' table', type: 'TABLE', value: t});
        offset += tableLength;
        check.argument(!isNaN(offset), 'Something went wrong calculating the offset.');
        while (offset % 4 !== 0) {
            offset += 1;
            tableFields.push({name: 'padding', type: 'BYTE', value: 0});
        }
    }

    sfnt.fields = sfnt.fields.concat(tableFields);
    return sfnt;
}

// Convert the font object to a SFNT data structure.
// This structure contains all the necessary tables and metadata to create a binary OTF file.
function fontToSfntTable(font) {
    var xMins = [];
    var yMins = [];
    var xMaxs = [];
    var yMaxs = [];
    var advanceWidths = [];
    var leftSideBearings = [];
    var rightSideBearings = [];
    for (var i = 0; i < font.glyphs.length; i += 1) {
        var glyph = font.glyphs[i];
        var metrics = glyph.getMetrics();
        xMins.push(metrics.xMin);
        yMins.push(metrics.yMin);
        xMaxs.push(metrics.xMax);
        yMaxs.push(metrics.yMax);
        leftSideBearings.push(metrics.leftSideBearing);
        rightSideBearings.push(metrics.rightSideBearing);
        advanceWidths.push(glyph.advanceWidth);
    }
    var globals = {
        xMin: Math.min.apply(null, xMins),
        yMin: Math.min.apply(null, yMins),
        xMax: Math.max.apply(null, xMaxs),
        yMax: Math.min.apply(null, yMaxs),
        advanceWidthMax: Math.max.apply(null, advanceWidths),
        minLeftSideBearing: Math.min.apply(null, leftSideBearings),
        maxLeftSideBearing: Math.max.apply(null, leftSideBearings),
        minRightSideBearing: Math.min.apply(null, rightSideBearings)
    };

    var headTable = head.make({
        unitsPerEm: font.unitsPerEm,
        xMin: globals.xMin,
        yMin: globals.yMin,
        xMax: globals.xMax,
        yMax: globals.yMax
    });
    // FIXME Make ascender/descender configurable.
    var hheaTable = hhea.make({
        ascender:  984,
        descender: -273,
        advanceWidthMax: globals.advanceWidthMax,
        minLeftSideBearing: globals.minLeftSideBearing,
        minRightSideBearing: globals.minRightSideBearing,
        xMaxExtent: globals.maxLeftSideBearing + (globals.xMax - globals.xMin),
        numberOfHMetrics: font.glyphs.length
    });
    var maxpTable = maxp.make(font.glyphs.length);
    var os2Table = os2.make();
    var hmtxTable = hmtx.make(font.glyphs);
    var cmapTable = cmap.make(font.glyphs);

    var fullName = font.familyName + ' ' + font.styleName;
    var postScriptName = font.familyName.replace(/\s/g, '') + '-' + font.styleName;
    var nameTable = _name.make({
        copyright: font.copyright,
        fontFamily: font.familyName,
        fontSubfamily: font.styleName,
        uniqueID: font.manufacturer + ':' + fullName,
        fullName: fullName,
        version: font.version,
        postScriptName: postScriptName,
        manufacturer: font.manufacturer,
        preferredFamily: font.familyName,
        preferredSubfamily: font.styleName
    });
    var postTable = post.make();
    var cffTable = cff.make(font.glyphs, {
        version: font.version,
        fullName: fullName,
        familyName: font.familyName,
        weightName: font.styleName,
        postScriptName: postScriptName
    });
    var tables = [headTable, hheaTable, maxpTable, os2Table, hmtxTable, cmapTable, nameTable, postTable, cffTable];

    var sfntTable = makeSfntTable(tables);

    var bytes = sfntTable.encode();
    var checkSum = computeCheckSum(bytes);
    headTable.checkSumAdjustment = 0xB1B0AFBA - checkSum;

    // Build the font again, now with the proper checkSum.
    sfntTable = makeSfntTable(tables);

    return sfntTable;
}

exports.computeCheckSum = computeCheckSum;
exports.make = makeSfntTable;
exports.fontToTable = fontToSfntTable;