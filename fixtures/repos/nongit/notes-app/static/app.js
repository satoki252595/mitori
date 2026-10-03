// Highlights the note under the pointer.
document.addEventListener("pointerover", (event) => {
  const item = event.target.closest("li");
  if (item) item.classList.add("hot");
});
