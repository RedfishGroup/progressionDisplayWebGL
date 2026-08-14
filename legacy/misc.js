export function loadProgressionImage(url) {
  return new Promise(function(resolve, reject) {
    var img = new Image()
    img.crossOrigin = "Anonymous";
    img.onload = function(ev){
      resolve(this)
    }
    img.onerror = reject
    img.src = url
  })
}

export function loadProgressionJSON(url) {
  return new Promise( function(resolve, reject) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.crossOrigin = "Anonymous";
    xhr.onload = function() {
      try{
          var json = JSON.parse(xhr.responseText)
      } catch(e){
          reject(e)
          return
      }
      resolve(json)
    };
    xhr.onerror = function () {
        callback(xhr.response)
    };
    xhr.send();
  })
}
