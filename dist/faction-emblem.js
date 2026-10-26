import * as THREE from './vendor/three/three.module.min.js';

// Original RP insignia with angular wings and a red enamel medallion.
// Coordinates match assets/emblem.svg, including the shield and coloured facets.
const outlines = {
  spine: [[160,8],[175,25],[167,49],[167,366],[160,410],[153,366],[153,49],[145,25]],
  spineRidge: [[160,15],[167,27],[160,48],[160,388],[157,364],[157,47],[152,27]],
  shield: [[160,59],[279,102],[274,216],[254,273],[224,323],[160,373],[96,323],[66,273],[46,216],[41,102]],
  rim: [[160,67],[271,108],[266,215],[247,269],[217,317],[160,361],[103,317],[73,269],[54,215],[49,108]],
  field: [[160,78],[259,116],[255,213],[237,263],[209,308],[160,346],[111,308],[83,263],[65,213],[61,116]],
  fieldFacet: [[160,91],[160,335],[117,301],[91,260],[74,211],[70,122]],
  wing: [[155,187],[86,148],[70,153],[88,186],[127,207],[97,199],[82,184],[83,210],[133,243],[153,225]],
  upperFeather: [[152,197],[93,164],[88,165],[100,185],[137,211]],
  lowerFeather: [[145,220],[102,205],[100,210],[133,234]],
  crest: [[160,146],[173,159],[160,178],[147,159]],
  heartRim: [[160,177],[196,195],[189,238],[160,265],[131,238],[124,195]],
  heart: [[160,187],[187,200],[182,233],[160,253],[138,233],[133,200]],
  plaqueRim: [[88,281],[160,287],[232,281],[226,329],[160,346],[94,329]],
  plaque: [[96,289],[160,295],[224,289],[219,323],[160,338],[101,323]]
};

export function createFactionEmblem() {
  const group = new THREE.Group();
  group.name = 'Russia Online — original faction emblem';
  const material = (color, metalness = .72, roughness = .3) => new THREE.MeshStandardMaterial({color,metalness,roughness});
  const silver = material(0xb4c3d3,.88,.25);
  const gold = material(0xd5b368,.83,.28);
  const paleGold = material(0xf2d99d,.78,.25);
  const shadeGold = material(0xa77b36,.75,.34);
  const navy = material(0x173958,.44,.3);
  const lightNavy = material(0x234b6f,.48,.34);
  const red = material(0x9f3440,.47,.29);
  const plaqueNavy = material(0x102940,.48,.3);
  const mirror = points => points.map(([x,y]) => [320-x,y]);
  function add(name, points, surface, z, depth = .055, bevel = .014) {
    const shape = new THREE.Shape();
    points.forEach(([x,y],index) => {
      const px = (x-160)/60, py = (210-y)/60;
      if (index) shape.lineTo(px,py); else shape.moveTo(px,py);
    });
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:bevel>0,bevelThickness:bevel,bevelSize:bevel,bevelSegments:2,steps:1,curveSegments:1});
    const mesh = new THREE.Mesh(geometry,surface);
    mesh.name = name; mesh.position.z = z; group.add(mesh);
  }
  addLaurelBranches(group,gold,paleGold);
  add('Silver axial prism',outlines.spine,silver,-.24,.1,.018);
  add('Gold prism ridge',outlines.spineRidge,gold,-.11,.035,.008);
  add('Faceted shield — titanium',outlines.shield,silver,0,.14,.025);
  add('Shield — brass surround',outlines.rim,gold,.17,.065,.017);
  add('Shield — blue enamel',outlines.field,navy,.255,.065,.012);
  add('Blue enamel facet',outlines.fieldFacet,lightNavy,.328,.012,0);
  add('Angular wing left',outlines.wing,gold,.36,.075,.014);
  add('Angular wing right',mirror(outlines.wing),gold,.36,.075,.014);
  add('Upper feather left',outlines.upperFeather,paleGold,.446,.025,.006);
  add('Upper feather right',mirror(outlines.upperFeather),paleGold,.446,.025,.006);
  add('Lower feather left',outlines.lowerFeather,shadeGold,.446,.025,.006);
  add('Lower feather right',mirror(outlines.lowerFeather),shadeGold,.446,.025,.006);
  add('Geometric crest',outlines.crest,paleGold,.36,.08,.014);
  add('RO medallion — brass',outlines.heartRim,gold,.48,.07,.014);
  add('RO medallion — red enamel',outlines.heart,red,.565,.028,.009);
  add('Lower plaque — brass',outlines.plaqueRim,gold,.36,.07,.014);
  add('Lower plaque — navy',outlines.plaque,plaqueNavy,.445,.026,.008);
  addLabel(group,'ФСБ',160,311,1.72,.48,.51,130);
  return group;
}


// Rounded gold laurel branches emerge from behind the shield.
function addLaurelBranches(group,gold,paleGold) {
  const leaves=[[80,328,27,315,9],[53,301,-3,277,10],[31,268,-23,230,11],[16,231,-29,184,11],[11,194,-21,140,10],[18,155,-4,99,9],[30,121,24,68,8]];
  const veinPoints=[];
  const xy=(x,y,side)=>new THREE.Vector2(((side ? 320-x : x)-160)/60,(210-y)/60);
  for (const side of [0,1]) {
    const move=(shape,x,y)=>{ const p=xy(x,y,side); shape.moveTo(p.x,p.y); };
    const line=(shape,x,y)=>{ const p=xy(x,y,side); shape.lineTo(p.x,p.y); };
    const quad=(shape,x,y,tx,ty)=>{const a=xy(x,y,side),b=xy(tx,ty,side);shape.quadraticCurveTo(a.x,a.y,b.x,b.y);};
    const cubic=(shape,x1,y1,x2,y2,x3,y3)=>{const a=xy(x1,y1,side),b=xy(x2,y2,side),c=xy(x3,y3,side);shape.bezierCurveTo(a.x,a.y,b.x,b.y,c.x,c.y);};
    const stem=new THREE.Shape();
    move(stem,110,354);cubic(stem,51,323,6,261,8,194);cubic(stem,9,154,23,120,39,100);line(stem,42,103);cubic(stem,25,125,14,157,13,194);cubic(stem,11,258,55,319,112,350);stem.closePath();
    const leafShapes=[],facets=[];
    for(const [bx,by,tx,ty,width] of leaves) {
      const length=Math.hypot(tx-bx,ty-by),nx=-(ty-by)/length,ny=(tx-bx)/length;
      const ax=(bx+tx)/2+nx*width,ay=(by+ty)/2+ny*width,cx=(bx+tx)/2-nx*width,cy=(by+ty)/2-ny*width;
      const leaf=new THREE.Shape();move(leaf,bx,by);quad(leaf,ax,ay,tx,ty);quad(leaf,cx,cy,bx,by);leaf.closePath();leafShapes.push(leaf);
      const facet=new THREE.Shape();move(facet,bx,by);quad(facet,ax,ay,tx,ty);line(facet,bx,by);facet.closePath();facets.push(facet);
      const a=xy(bx,by,side),b=xy(tx,ty,side);veinPoints.push(a.x,a.y,-.052,b.x,b.y,-.052);
    }
    for(const [name,shapes,surface,z,depth,bevel] of [['stem',[stem],gold,-.16,.028,.004],['leaves',leafShapes,gold,-.12,.045,.006],['leaf highlights',facets,paleGold,-.064,.006,0]]) {
      const geometry=new THREE.ExtrudeGeometry(shapes,{depth,bevelEnabled:bevel>0,bevelThickness:bevel,bevelSize:bevel,bevelSegments:2,steps:1,curveSegments:10});
      const mesh=new THREE.Mesh(geometry,surface);mesh.name=(side?'Right':'Left')+' laurel '+name;mesh.position.z=z;group.add(mesh);
    }
  }
  const geometry=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(veinPoints,3));
  const veins=new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:0xa77b36}));veins.name='Laurel leaf midribs';group.add(veins);
}

function addLabel(group,text,x,y,width,height,z,fontSize) {
  // Geometry remains testable without a DOM; browser scenes receive the labels.
  if (typeof document === 'undefined') return;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return;
  context.font = `700 ${fontSize}px Arial, sans-serif`;
  const metrics = context.measureText(text);
  const left = Math.max(0,metrics.actualBoundingBoxLeft || 0);
  const right = Math.max(1,metrics.actualBoundingBoxRight || metrics.width);
  const ascent = Math.max(1,metrics.actualBoundingBoxAscent || fontSize*.78);
  const descent = Math.max(0,metrics.actualBoundingBoxDescent || 0);
  const padding = Math.max(2,Math.ceil(fontSize*.045));
  canvas.width = Math.ceil(left+right+padding*2);
  canvas.height = Math.ceil(ascent+descent+padding*2);
  // Resizing resets the context. Draw against the measured glyph bounds so
  // transparent margins do not shrink inscriptions when mapped onto the plane.
  context.font = `700 ${fontSize}px Arial, sans-serif`;
  context.fillStyle = '#f2dda4';
  context.textAlign = 'left'; context.textBaseline = 'alphabetic';
  context.fillText(text,padding+left,padding+ascent);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const surface = new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,alphaTest:.02,toneMapped:false});
  const label = new THREE.Mesh(new THREE.PlaneGeometry(width,height),surface);
  label.name = `Inscription ${text}`;
  label.position.set((x-160)/60,(210-y)/60,z);
  group.add(label);
}
