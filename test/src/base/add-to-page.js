module.exports = function (text) {
  const h2 = document.createElement('h2')
  h2.textContent = text
  document.body.appendChild(h2)
}
