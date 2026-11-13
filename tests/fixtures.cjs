// Synthetic uncompressed CFA DNG: no third-party photographs or camera files.
exports.syntheticDng = function ({width=64,height=48}={}) {
  const entries=[];
  const sizes={1:1,2:1,3:2,4:4,5:8,10:8};
  const add=(tag,type,values)=>{
    if(type===2)values=Array.from(Buffer.from(values+'\0'));
    const data=Buffer.alloc(values.length*sizes[type]);
    values.forEach((v,i)=>{
      const offset=i*sizes[type];
      if(type<=2)data[offset]=v;
      else if(type===3)data.writeUInt16LE(v,offset);
      else if(type===4)data.writeUInt32LE(v,offset);
      else {data.writeInt32LE(v[0],offset);data.writeInt32LE(v[1],offset+4);}
    });
    entries.push({tag,type,count:values.length,data});
  };
  add(254,4,[0]);add(256,4,[width]);add(257,4,[height]);add(258,3,[16]);add(259,3,[1]);
  add(262,3,[32803]);add(271,2,'Emulsion');add(272,2,'Synthetic CFA');add(273,4,[0]);
  add(274,3,[1]);add(277,3,[1]);add(278,4,[height]);add(279,4,[width*height*2]);add(284,3,[1]);
  add(33421,3,[2,2]);add(33422,1,[0,1,1,2]);
  add(50706,1,[1,4,0,0]);add(50707,1,[1,1,0,0]);add(50708,2,'Emulsion synthetic CFA fixture');
  add(50710,1,[0,1,2]);add(50711,3,[1]);add(50713,3,[1,1]);add(50714,5,[[0,1]]);add(50717,4,[16383]);
  add(50719,4,[0,0]);add(50720,4,[width,height]);
  add(50721,10,[[1,1],[0,1],[0,1],[0,1],[1,1],[0,1],[0,1],[0,1],[1,1]]);
  add(50728,5,[[1,1],[1,1],[1,1]]);add(50778,3,[21]);
  entries.sort((a,b)=>a.tag-b.tag);
  const tableEnd=8+2+entries.length*12+4;
  let offset=tableEnd;
  for(const entry of entries)if(entry.data.length>4){entry.offset=offset;offset+=entry.data.length+(entry.data.length%2);}
  entries.find(x=>x.tag===273).data.writeUInt32LE(offset);
  const out=Buffer.alloc(offset+width*height*2);
  out.write('II');out.writeUInt16LE(42,2);out.writeUInt32LE(8,4);out.writeUInt16LE(entries.length,8);
  entries.forEach((entry,i)=>{
    const p=10+i*12;out.writeUInt16LE(entry.tag,p);out.writeUInt16LE(entry.type,p+2);out.writeUInt32LE(entry.count,p+4);
    if(entry.offset){out.writeUInt32LE(entry.offset,p+8);entry.data.copy(out,entry.offset);}else entry.data.copy(out,p+8);
  });
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)out.writeUInt16LE(1000+(x%64)*100+(y%48)*80,offset+(y*width+x)*2);
  return out;
};
