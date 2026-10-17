/* Dependency-free Office Open XML (.xlsx) exporter. Uses ZIP store and inline strings. */
(function(){
  'use strict';
  const utf8 = text => new TextEncoder().encode(text);
  const escapeXml = value => String(value == null ? '' : value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
  const colName = number => {let result='';for(let n=number+1;n;n=Math.floor((n-1)/26))result=String.fromCharCode(65+(n-1)%26)+result;return result};
  const uint16=(view,offset,value)=>view.setUint16(offset,value,true);
  const uint32=(view,offset,value)=>view.setUint32(offset,value>>>0,true);
  const crcTable=new Uint32Array(256);
  for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);crcTable[n]=c>>>0}
  const crc32=bytes=>{let crc=0xffffffff;for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0};
  function zip(items) {
    const parts=[],central=[];let offset=0;
    for(const [name,contents] of items) {
      const n=utf8(name),d=utf8(contents),crc=crc32(d);
      const local=new Uint8Array(30+n.length),v=new DataView(local.buffer);
      uint32(v,0,0x04034b50);uint16(v,4,20);uint16(v,6,0x0800);
      uint16(v,8,0);uint16(v,10,0);uint16(v,12,33);uint32(v,14,crc);
      uint32(v,18,d.length);uint32(v,22,d.length);uint16(v,26,n.length);
      local.set(n,30);parts.push(local,d);
      const entry=new Uint8Array(46+n.length),c=new DataView(entry.buffer);
      uint32(c,0,0x02014b50);uint16(c,4,20);uint16(c,6,20);uint16(c,8,0x0800);
      uint16(c,10,0);uint16(c,12,0);uint16(c,14,33);uint32(c,16,crc);
      uint32(c,20,d.length);uint32(c,24,d.length);uint16(c,28,n.length);uint32(c,42,offset);
      entry.set(n,46);central.push(entry);offset+=local.length+d.length;
    }
    const directory=central.reduce((n,d)=>n+d.length,0),end=new Uint8Array(22),e=new DataView(end.buffer);
    uint32(e,0,0x06054b50);uint16(e,8,items.length);uint16(e,10,items.length);
    uint32(e,12,directory);uint32(e,16,offset);
    return new Blob([...parts,...central,end],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }
  function workbook(rows) {
    const header=Array.isArray(rows[0])?rows[0]:[];
    const body=rows.map((row,ri)=>'<row r="'+(ri+1)+'">'+row.map((value,ci)=>{
      const coordinate=colName(ci)+(ri+1),style=ri===0?' s="1"':'';
      const raw=String(value==null?'':value);
      return '<c r="'+coordinate+'"'+style+' t="inlineStr"><is><t xml:space="preserve">'+escapeXml(raw)+'</t></is></c>';
    }).join('')+'</row>').join('');
    const width=header.map((_,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+(i===3?33:20)+'" customWidth="1"/>').join('');
    const sheet='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>'+width+'</cols><sheetData>'+body+'</sheetData><autoFilter ref="A1:'+colName(header.length-1)+Math.max(1,rows.length)+'/></worksheet>';
    const workbook='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Production Orders" sheetId="1" r:id="rId1"/></sheets></workbook>';
    const styles='<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1C3967"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="1" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>';
    return zip([
      ['[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
      ['_rels/.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml',workbook],
      ['xl/_rels/workbook.xml.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
      ['xl/styles.xml',styles],['xl/worksheets/sheet1.xml',sheet]
    ]);
  }
  window.ASXLSX={
    build:workbook,
    download(rows,name) {
      if(!Array.isArray(rows)||!rows.length)throw new Error('No data to export.');
      const blob=workbook(rows),url=URL.createObjectURL(blob),a=document.createElement('a');
      a.href=url;a.download=(name||'production-orders')+'.xlsx';document.body.appendChild(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),5000);
    }
  };
})();