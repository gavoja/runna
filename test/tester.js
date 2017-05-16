setTimeout(() => {
  console.log(process.argv[2] + '\r\nline 2\nline 3\n\r\n')
}, parseInt(process.argv[3], 10))
