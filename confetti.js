function launchConfetti() {
  // Create canvas element
  const canvas = document.createElement('canvas');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.position = 'fixed';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.pointerEvents = 'none';
  canvas.style.zIndex = '9999';
  document.body.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  const confetti = [];

  // Confetti particle class
  class Confetti {
    constructor() {
      this.x = Math.random() * canvas.width;
      this.y = Math.random() * canvas.height - canvas.height;
      this.size = Math.random() * 10 + 5;
      this.color = `hsl(${Math.random() * 360}, 50%, 50%)`;
      this.speedY = Math.random() * 3 + 1;
      this.speedX = Math.random() * 2 - 1;
    }

    update() {
      this.y += this.speedY;
      this.x += this.speedX;

      if (this.y > canvas.height) {
        this.y = -this.size;
        this.x = Math.random() * canvas.width;
      }
    }

    draw() {
      ctx.fillStyle = this.color;
      ctx.fillRect(this.x, this.y, this.size, this.size);
    }
  }

  // Create confetti particles
  function createConfetti() {
    for (let i = 0; i < 100; i++) {
      confetti.push(new Confetti());
    }
  }

  // Animate confetti
  function animateConfetti() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    confetti.forEach(particle => {
      particle.update();
      particle.draw();
    });

    requestAnimationFrame(animateConfetti);
  }

  // Start confetti
  createConfetti();
  animateConfetti();

  // Remove confetti after 5 seconds
  setTimeout(() => {
    document.body.removeChild(canvas);
  }, 5000);
}