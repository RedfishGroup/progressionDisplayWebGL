
export var WebGLUtils = {

  makeFailHTML : function(msg) {
    return '' +
    '<table style="background-color: #8CE; width: 100%; height: 100%;"><tr>' +
    '<td align="center">' +
    '<div style="display: table-cell; vertical-align: middle;">' +
    '<div style="">' + msg + '</div>' +
    '</div>' +
    '</td></tr></table>';
  },

  GET_A_WEBGL_BROWSER : `This page requires a browser that supports WebGL.<br/>
  <a href="http://get.webgl.org">Click here to upgrade your browser.</a>`,


  OTHER_PROBLEM : `It doesn't appear your computer can support WebGL.<br/>
  <a href="http://get.webgl.org/troubleshooting/">Click here for more information.</a>`,


  is_webgl_supported: function() {
    try {
      var canvas = document.createElement('canvas');
      if (!!window.WebGLRenderingContext && (
        canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))) {
          canvas = null
          return true
        }
      } catch (e) {
        return false;
      }
    },


    setupWebGL : function(canvas, opt_attribs) {
      function showLink(str) {
        var container = canvas.parentNode;
        if (container) {
          container.innerHTML = makeFailHTML(str);
        }
      };

      if (!window.WebGLRenderingContext) {
        showLink(GET_A_WEBGL_BROWSER);
        return null;
      }

      var context = this.create3DContext(canvas, opt_attribs);
      if (!context) {
        showLink(OTHER_PROBLEM);
      }
      return context;
    },


    create3DContext : function(canvas, opt_attribs) {
      var names = ["webgl", "experimental-webgl", "webkit-3d", "moz-webgl"];
      var context = null;
      for (var ii = 0; ii < names.length; ++ii) {
        try {
          context = canvas.getContext(names[ii], opt_attribs);
        } catch (e) {}
        if (context) {
          break;
        }
      }
      return context;
    },


    //
    //  initShaders.js
    //
    initShaders: function (gl, vertexShaderId, fragmentShaderId) {
      var vertShdr;
      var fragShdr;

      var vertElem = document.getElementById(vertexShaderId) || {text: vertexShaderId}; //if it doesnt find the element then assume its a string

      if (!vertElem) {
        throw("Unable to load vertex shader " + vertexShaderId);
        return -1;
      } else {
        vertShdr = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vertShdr, vertElem.text);
        gl.compileShader(vertShdr);
        if (!gl.getShaderParameter(vertShdr, gl.COMPILE_STATUS)) {
          var msg = "Vertex shader failed to compile.  The error log is:" + "<pre>" + gl.getShaderInfoLog(vertShdr) + "</pre>";
          throw(msg);
          return -1;
        }
      }

      var fragElem = document.getElementById(fragmentShaderId) || {text: fragmentShaderId};
      if (!fragElem) {
        throw("Unable to load vertex shader " + fragmentShaderId);
        return -1;
      } else {
        fragShdr = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fragShdr, fragElem.text);
        gl.compileShader(fragShdr);
        if (!gl.getShaderParameter(fragShdr, gl.COMPILE_STATUS)) {
          var msg = "Fragment shader failed to compile.  The error log is:" + "<pre>" + gl.getShaderInfoLog(fragShdr) + "</pre>";
          throw(msg);
          return -1;
        }
      }

      var program = gl.createProgram();
      gl.attachShader(program, vertShdr);
      gl.attachShader(program, fragShdr);
      gl.linkProgram(program);

      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        var msg = "Shader program failed to link.  The error log is:" + "<pre>" + gl.getProgramInfoLog(program) + "</pre>";
        throw(msg);
        return -1;
      }

      return program;
    }
  }
