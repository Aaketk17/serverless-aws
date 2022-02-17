const data = new Date().valueOf()

const val = {
  v: data,
}

console.log('1', val)
const arr = []

for (i = 0; i < 80000000; i++) {
  arr.push(i)
}

console.log('2', val)
