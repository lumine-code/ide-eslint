function average(samples) {
  return samples.reduce((sum, value) => sum + value, 0) / samples.length;
}

const samples = [0.2, 0.8, -0.4, 0.5, 1.0];
const windowSize = 3;
average(samples);
