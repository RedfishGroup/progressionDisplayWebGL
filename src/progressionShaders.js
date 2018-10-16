
export var vertexShader = `precision highp float;
  attribute vec4 vPosition;
  attribute vec2 a_texCoord;
  uniform mat4 projection;
  varying vec2 v_texCoord;
  //uniform vec2 texDims;
  void main() {
      v_texCoord = a_texCoord;
      gl_Position = projection * vPosition;
  }`

export var fragmentShader = `precision highp float;
  uniform sampler2D u_image;
  varying vec2 v_texCoord;
  uniform float timeSeconds;
  uniform float lastTime;
  uniform bool isWater;
  //uniform vec2 texDims;
  // Official HSV to RGB conversion
  vec3 hsv2rgb( in vec3 c ) {
      vec3 rgb = clamp( abs(mod(c.x*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0, 0.0, 1.0 );
      return c.z * mix( vec3(1.0), rgb, c.y);
  }

  float color2number(vec4 c) {
    float bs = 255.0;//base
    float r = floor(c.r*bs*bs*bs);
    float g = floor(c.g*bs*bs);
    float b = floor(c.b*bs);
    float val = r+g+b;
    if(c.a < 1.0 || c.r >= 1.0) {
      return 0.0;
    }
    return val;
  }

  float getDiff(vec2 texCoord) {
      vec4 data = texture2D(u_image, texCoord);
      float val = color2number(data);
      float diff = timeSeconds - val;
      if(data.r >= 1.0){
          return -1.0;
      }
      return diff;
  }
  int isFireBorder( float percentWide) {
      float dd = percentWide * 0.005;//percentWide/texDims;
      float up=getDiff(v_texCoord + dd * vec2(0.0, 1.0));
      float dn=getDiff(v_texCoord + dd * vec2(0.0, -1.0));
      float left=getDiff(v_texCoord + dd * vec2(-1.0, 0.0));
      float right=getDiff(v_texCoord + dd * vec2(1.0, 0.0));
       if( up <= 0.0 || dn <= 0.0 || left <= 0.0 || right <= 0.0 ){
          return 1;
      }
      return 0;
  }

  void main() {
      vec4 data = texture2D(u_image, v_texCoord);
      float val = color2number(data);
      float diff = getDiff(v_texCoord);
      gl_FragColor = vec4(0.0,0.0,0.0,0.0);
      if( diff > 0.0 ){
          float rat = diff/(255.0*255.0);
          //   TODO: need to get final time in order to use this
          if( timeSeconds >= lastTime - 1.0 || lastTime <= 0.0){
              gl_FragColor = vec4( hsv2rgb( vec3(floor(rat)/24.0,1.0,0.5 ) ), 0.8);
          } else {
            // color the borders
            if( isFireBorder(1.5) == 1 ) {
                gl_FragColor = vec4(0.9, 0.9, 0.1, 0.8);
            } else if( isFireBorder(3.5) == 1 ){
              gl_FragColor = vec4(0.9, 0.3, 0.1, 0.8);
            } else if( isFireBorder(6.5) == 1 ){
              gl_FragColor = vec4(0.7, 0.1, 0.1, 0.8);
            } else {
              gl_FragColor = vec4( 0.2, 0.1, 0.0, 0.7);
            }
          }
          if (isWater) {
            gl_FragColor = vec4( 0.0, 0.0, 1.0, 0.5);
          }
          // todo water color
          //float rat = diff/(255.0*4.0);
          //gl_FragColor = vec4( 0.0, 1.0-rat*rat, max(2.0-rat,0.3), 0.5);
      }
      //gl_FragColor = gl_FragColor + vec4(0.0, 0.0, 1.0, 0.3);
  }`
