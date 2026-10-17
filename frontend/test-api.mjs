async function run() {
  try {
    const res = await fetch('https://multicanaishd.lol/api/detalhes?id=76479&type=tv&season=4');
    const text = await res.text();
    console.log("STATUS:", res.status);
    console.log("BODY_START:", text.substring(0, 500));
  } catch(e) {
    console.log("Error:", e);
  }
}
run();

