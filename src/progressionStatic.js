console.log('progression static')

import {vertexShader, fragmentShader} from "./progressionShaders.js"
import {WebGLUtils} from "./webGLUtils.js"
import {webGLHelpers} from "./webGLHelpers.js"

//function staticProgression(){return 'fu'}
//export default staticProgression

export default class staticProgression {

  constructor (canvas, options) {
    this.gl = null
    this.canvas = null
    this.metaData = null
    this.time = 0
    //
    this.__deltaTimeAnim = 10000
    this.progImageTexture = null
    this.progImage = null
    this.timeSecondsLoc = null
    this.lastDrawTime = null
    this.lastDrawCount = 0
    this.isWater = false
    this.points  = [
      [-1, -1, -1],
      [-1, 1, -1],
      [1, 1, -1],
      [-1, -1, -1],
      [1, 1, -1],
      [1, -1, -1]
    ]
    this.textures  = [
      [0, 0],
      [0, 1],
      [1, 1],
      [0, 0],
      [1, 1],
      [1, 0]
    ]
    //
    // shaders.
    //
    this.vertexShader = vertexShader
    this.fragmentShader = fragmentShader
    //
    this.initialize(canvas, options)
  }

  //
  initialize (canvas, options) {
    options = options || {}
    this.canvas = canvas
    this.canvas.id = "progression-canvas"
    this.canvas.width = options.width || 400
    this.canvas.height = options.height || 400
    this.initGL()
  }

  startTime () {
    if( !this.metaData) { return 0}
    return this.metaData.UTC[0]
  }

  endTime () {
    if( !this.metaData) { return 0}
    return this.metaData.UTC[this.metaData.UTC.length-1]
  }

  // return estimate of acres based on whats in the meta data, I would prefer to calculate this, but it can be slow, and in the pst has been innacurate.
  getAcres () {
    if(!this.metaData) { return 0}
    var acres = 0
    var md = this.metaData
    if( md.UTC && md.acres && md.UTC.length > 1) {
      var t0 = md.UTC[0]
      for(var i=1 ; i<md.UTC.length; i++) {
        var t1=md.UTC[i]
        if(t0 < this.time && t1 >= this.time) {
          acres = (this.time / (t1 - t0)) * (md.acres[i] - md.acres[i-1]) + md.acres[i-1]
        }
        var t0 = t1
      }
      if( this.time > this.endTime()) {
        acres = md.acres[ md.acres.length-1]
      }
    }
    return Math.round(acres)
  }

  // returns the time elapsed as a ratio.
  timeAsRatio ( time) {
    time = time || this.time
    return (time - this.startTime() )/(this.endTime() - this.startTime())
  }

  initGL () {
    this.gl = WebGLUtils.setupWebGL(this.canvas);
    var canvas = this.canvas; //document.getElementById("gl-canvas");
    if (!this.gl) {
      alert("WebGL isn't available");
    }
    this.gl.viewport(0, 0, canvas.width, canvas.height);
    this.gl.clearColor(0.0, 0.0, 0.0, 0.05);
    this.gl.enable(this.gl.BLEND)
    this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA)
    //this.gl.blendFuncSeparate(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA, this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA);
    //
    //  Load shaders and initialize attribute buffers
    //
    var program = WebGLUtils.initShaders(this.gl, this.vertexShader, this.fragmentShader);
    this.gl.useProgram(program);
    this.program = program
    //
    this.vBuffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, webGLHelpers.flatten(this.points), this.gl.STATIC_DRAW);
    //
    var vPosition = this.gl.getAttribLocation(program, "vPosition");
    this.gl.vertexAttribPointer(vPosition, 3, this.gl.FLOAT, false, 0, 0);
    this.gl.enableVertexAttribArray(vPosition);
    // TEXTURE STUFF
    var texCoordLocation = this.gl.getAttribLocation(program, "a_texCoord");
    var texCoordBuffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, texCoordBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, webGLHelpers.flatten(this.textures), this.gl.STATIC_DRAW);
    this.gl.enableVertexAttribArray(texCoordLocation);
    this.gl.vertexAttribPointer(texCoordLocation, 2, this.gl.FLOAT, false, 0, 0);
    // Create a texture.
    this.progImageTexture = this.gl.createTexture();
    // uniforms
    this.timeSecondsLoc = this.gl.getUniformLocation(program, "timeSeconds")
    this.isWaterLoc = this.gl.getUniformLocation(program, "isWater")
  }

  setProgressionImage (image1) {
    this.progImage = image1
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.progImageTexture);
    // Set the parameters so we can render any size image.
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
    // change actual texture
    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, image1);
  }

  setProgressionJson (json) {
    this.metaData = json
    if( json.bounds) {
      var ul_ltln = [json.bounds.maxlat, json.bounds.minlon]
      var lr_ltln = [json.bounds.minlat, json.bounds.maxlon]
    } else if( json.worldfile4326) {
      //transform according to the worldfile
      //find coords of worldfile
      //adbecf
      console.log('using worldfile')
      var wf = json.worldfile4326
      var a = wf.split(' ')
      if( a.length !=6){
        a = wf.split('\n')
      }
      if( a.length !=6){
        a = wf.split('↵')
      }
      if( a.length !=6){
        throw('error parsing json')
      }
      var res = {a:Number(a[0]), d:Number(a[1]), b:Number(a[2]), e:Number(a[3]), c:Number(a[4]), f:Number(a[5]) }
      this.WFparams = res
      var ul_ltln = [this.WFparams.f, this.WFparams.c] //upper-left
      var lrln = this.WFparams.c + this.progImage.width * this.WFparams.a; //lower-right latitude, lon
      var lrlt = this.WFparams.f + this.progImage.height * this.WFparams.e;
      var lr_ltln = [lrlt, lrln]
    }
    this.bounds = json.bounds //new L.LatLngBounds(ul_ltln, lr_ltln)
    if(json.flood) {
      this.isWater = true
    } else  {
      this.isWater = false
    }
    //var mapProjection = this.getProjectionMatrix(this.canvas.width, this.canvas.height, this.bounds)
    //
    this.ul_latLon = ul_ltln
    this.lr_latLon = lr_ltln
    //
    // find min time. todo find max time also
    this.minTime = this.metaData.UTC[0];
  }


  resize (width, height) {
    console.log('resize called')
    this.canvas.width = width
    this.canvas.height = height
    this.gl.viewport(0, 0, width, height)
    this.draw()
  }

  //
  // call this every time you want to update something on the canvas
  //
  draw () {
    //console.log("draw called")
    if (this.visibility == false) {
      return; //my work is not needed
    }
    if (!this.canvas) {
      console.log(" canvas not found");
      return;
    }
    if (!this.progImage) {
      console.log("No world image. Image might not be loaded yet");
      return;
    }
    //calculate frames per second
    if( !this.lastDrawTime || new Date().getTime() -  this.lastDrawTime > 3000){
      console.log( 'progression fps = ', 1000 * this.lastDrawCount / (new Date().getTime() -  this.lastDrawTime) )
      this.lastDrawTime = new Date().getTime()
      this.lastDrawCount = 0
    }
    this.lastDrawCount ++
    // get projection matrix
    var projection = this.getProjectionMatrix(this.canvas.width, this.canvas.height, this.bounds)
    // bind buffers and what not
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vBuffer)
    this.gl.bufferData(this.gl.ARRAY_BUFFER, webGLHelpers.flatten(this.points), this.gl.STATIC_DRAW)
    this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT)
    var mytime = (this.time - this.startTime()) / 1000
    var endTime = (this.endTime() - this.startTime()) / 1000
    this.gl.uniform1f(this.timeSecondsLoc, mytime)
    this.gl.uniform1i(this.isWaterLoc, this.isWater)
    this.gl.uniformMatrix4fv(this.gl.getUniformLocation( this.program, "projection" ), false,  webGLHelpers.flatten(projection))
    this.gl.uniform1f( this.gl.getUniformLocation(this.program, "lastTime"), endTime)
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
  }

  getProjectionMatrix () {
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  }

  destroy () { // TODO: this probably is not enough
    this.canvas = null
  }

}
