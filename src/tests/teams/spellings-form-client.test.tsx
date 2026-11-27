import { afterEach, describe, expect, it } from "vitest";

class FrameElement {}

function element(tag: string, owner: DocumentShim) {
  const node = {
    tagName: tag.toUpperCase(),
    nodeName: tag.toUpperCase(),
    nodeType: 1,
    childNodes: [] as unknown[],
    children: [] as unknown[],
    attributes: {} as Record<string, string>,
    style: {},
    parentNode: null as unknown,
    ownerDocument: owner,
    namespaceURI: "http://www.w3.org/1999/xhtml",
    textContent: "",
    _value: "",
    setAttribute(name: string, value: string) {
      this.attributes[name] = String(value);
    },
    getAttribute(name: string) {
      return this.attributes[name] ?? null;
    },
    removeAttribute(name: string) {
      delete this.attributes[name];
    },
    hasAttribute(name: string) {
      return name in this.attributes;
    },
    appendChild(child: { parentNode: unknown; nodeType: number }) {
      child.parentNode = this;
      this.childNodes.push(child);
      if (child.nodeType === 1) this.children.push(child);
      return child;
    },
    removeChild(child: { parentNode: unknown }) {
      this.childNodes = this.childNodes.filter((item) => item !== (child as unknown));
      this.children = this.children.filter((item) => item !== child);
      child.parentNode = null;
      return child;
    },
    insertBefore(child: { parentNode: unknown; nodeType: number }) {
      return this.appendChild(child);
    },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true;
    },
    focus() {},
    blur() {},
    contains() {
      return false;
    },
    get value() {
      return this._value;
    },
    set value(next: string) {
      this._value = next == null ? "" : String(next);
    },
  };
  return node;
}

type DocumentShim = {
  nodeType: number;
  nodeName: string;
  HTMLIFrameElement: typeof FrameElement;
  body: ReturnType<typeof element> | null;
  documentElement: ReturnType<typeof element> | null;
  activeElement: null;
  createElement: (tag: string) => ReturnType<typeof element>;
  createElementNS: (namespace: string, tag: string) => ReturnType<typeof element>;
  createTextNode: (text: string) => { nodeType: number; textContent: string; nodeName: string; parentNode: null; childNodes: [] };
  addEventListener: () => void;
  removeEventListener: () => void;
};

function installDocument(): DocumentShim {
  const document = {
    nodeType: 9,
    nodeName: "#document",
    HTMLIFrameElement: FrameElement,
    body: null,
    documentElement: null,
    activeElement: null,
    createElement(tag: string) {
      const node = element(tag, document);
      return node;
    },
    createElementNS(_namespace: string, tag: string) {
      return this.createElement(tag);
    },
    createTextNode(text: string) {
      return { nodeType: 3, textContent: String(text), nodeName: "#text", parentNode: null, childNodes: [] as [] };
    },
    addEventListener() {},
    removeEventListener() {},
  } as DocumentShim;
  document.body = document.createElement("body");
  document.documentElement = document.createElement("html");
  Object.assign(globalThis, {
    document,
    HTMLElement: class {},
    HTMLIFrameElement: FrameElement,
    Element: class {},
    Node: class {},
    IS_REACT_ACT_ENVIRONMENT: true,
    window: globalThis,
  });
  return document;
}

function inputValues(node: { tagName?: string; name?: string; childNodes?: unknown[]; getAttribute?: (name: string) => string | null; value?: string }) {
  const values: string[] = [];
  const walk = (current: typeof node) => {
    const field = current.name ?? current.getAttribute?.("name") ?? "";
    if (current.tagName === "INPUT" && field.startsWith("alias_")) {
      values.push(current.value ?? "");
    }
    for (const child of current.childNodes ?? []) walk(child as typeof node);
  };
  walk(node);
  return values;
}

describe("team spelling fields in one client session", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "document");
  });

  it("shows the second club's own spellings after the first club", async () => {
    const document = installDocument();
    const [{ createElement }, { act }, { createRoot }, { ClubSpellingsForm }] = await Promise.all([
      import("react"),
      import("react"),
      import("react-dom/client"),
      import("@/app/admin/teams/spellings-form"),
    ]);
    const host = document.createElement("div");
    document.body?.appendChild(host);
    const root = createRoot(host as never);
    const latin = `Динамо М${String.fromCodePoint(0x78)}`;
    const renderClub = (clubKey: string, canonical: string, aliases: string[]) =>
      act(async () => {
        root.render(createElement(ClubSpellingsForm, {
          action: () => undefined,
          aliases,
          canonical,
          clubKey,
          key: clubKey,
        }));
      });

    await renderClub("динамо мx", latin, ["Махачкала", "Динамо Махачкала", "Динамо Мх"]);
    expect(inputValues(host)).toEqual(["Махачкала", "Динамо Махачкала", "Динамо Мх"]);

    await renderClub("крылья советов", "Крылья Советов", ["Кр Советов"]);
    expect(inputValues(host)).toEqual(["Кр Советов", "", ""]);

    await renderClub("динамо мx", latin, ["Махачкала", "Динамо Махачкала", "Динамо Мх"]);
    expect(inputValues(host)).toEqual(["Махачкала", "Динамо Махачкала", "Динамо Мх"]);
    root.unmount();
  });
});
