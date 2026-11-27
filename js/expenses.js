(() => {
  const params = new URLSearchParams(location.search);
  const q = new URLSearchParams();
  q.set("kind", "expenses");
  if (params.get("room")) q.set("room", params.get("room"));
  if (params.get("person")) q.set("person", params.get("person"));
  location.replace("activity.html?" + q.toString());
})();
