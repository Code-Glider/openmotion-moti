/** Runs only in the derived native document; font loading is distinct from the timeline protocol. */
export function fontBridge(all = false) {
  const surface = window as typeof window & { __openMotionFonts?: Promise<void>; __hfStartupError?: string };
  const loaded = async () => {
    const families = JSON.parse(document.documentElement.getAttribute("data-open-motion-fonts") ?? "[]") as string[];
    if (families.length > 64 || families.some((family) => !/^OpenMotionFont_[a-f0-9]{64}$/.test(family)))
      throw Error("invalid project font identities");
    await Promise.all(
      families.map(async (family) => {
        const faces = await document.fonts.load(`16px "${family}"`);
        if (!faces.length || faces.some((face) => face.status !== "loaded")) throw Error("project font unavailable");
      }),
    );
    if (all) {
      const faces = [...document.fonts];
      if (faces.length > 64) throw Error("template font face limit exceeded");
      await Promise.all(faces.map((face) => face.load()));
    }
    await document.fonts.ready;
    if ([...document.fonts].some((face) => face.status === "error")) throw Error("native font unavailable");
  };
  surface.__openMotionFonts = loaded();
  void surface.__openMotionFonts.then(
    () => parent.postMessage({ source: "open-motion-fonts", protocolVersion: 1, ready: true }, "*"),
    () => {
      surface.__hfStartupError = "Project font loading failed";
      parent.postMessage({ source: "open-motion-fonts", protocolVersion: 1, ready: false }, "*");
    },
  );
}
