import { describe, it, expect } from "vitest";
import { extractSymbols, parseFile } from "../src/parser.js";

describe("extractSymbols", () => {
  it("extracts class and methods with qualified names from TypeScript", async () => {
    const source = `
class PiHost {
  private async createSdkRuntime() {}
  private handleEvent() {}
}
`;
    const result = await extractSymbols("test.ts", source);

    expect(result).toHaveLength(3);

    const klass = result.find((s) => s.kind === "class");
    expect(klass).toBeDefined();
    expect(klass!.name).toBe("PiHost");
    expect(klass!.qualified).toBe("PiHost");
    expect(klass!.file).toBe("test.ts");

    const methods = result.filter((s) => s.kind === "method");
    expect(methods).toHaveLength(2);
    const methodNames = methods.map((m) => m.name).sort();
    expect(methodNames).toEqual(["createSdkRuntime", "handleEvent"]);

    const m1 = result.find((s) => s.name === "createSdkRuntime");
    expect(m1!.qualified).toBe("PiHost.createSdkRuntime");

    const m2 = result.find((s) => s.name === "handleEvent");
    expect(m2!.qualified).toBe("PiHost.handleEvent");
  });

  it("extracts top-level function from TypeScript", async () => {
    const source = `export function start() {}`;
    const result = await extractSymbols("test.ts", source);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("start");
    expect(result[0].kind).toBe("function");
    expect(result[0].qualified).toBe("start");
  });

  it("extracts symbols from TSX files", async () => {
    const source = `
export function App() {
    return <div>Hello</div>;
}
`;
    const result = await extractSymbols("test.tsx", source);

    const functions = result.filter((s) => s.kind === "function");
    expect(functions).toHaveLength(1);
    expect(functions[0].name).toBe("App");
  });

  it("extracts class, methods, and top-level function from Python", async () => {
    const source = `
def top_level():
    pass

class MyClass:
    def method_one(self):
        pass

    def method_two(self):
        pass
`;
    const result = await extractSymbols("test.py", source);

    const funcs = result.filter((s) => s.kind === "function");
    expect(funcs).toHaveLength(1);
    expect(funcs[0].name).toBe("top_level");

    const classes = result.filter((s) => s.kind === "class");
    expect(classes).toHaveLength(1);
    expect(classes[0].name).toBe("MyClass");

    const methods = result.filter((s) => s.kind === "method");
    expect(methods).toHaveLength(2);
    expect(methods.map((m) => m.qualified).sort()).toEqual([
      "MyClass.method_one",
      "MyClass.method_two",
    ]);
  });

  it("extracts function declaration from Go", async () => {
    const source = `package main

func main() {
    println("hello")
}
`;
    const result = await extractSymbols("test.go", source);

    const functions = result.filter((s) => s.kind === "function");
    expect(functions).toHaveLength(1);
    expect(functions[0].name).toBe("main");
    expect(functions[0].file).toBe("test.go");
  });

  it("extracts type declaration as class from Go", async () => {
    const source = `package main

type Server struct {
    port int
}
`;
    const result = await extractSymbols("test.go", source);

    const classes = result.filter((s) => s.kind === "class");
    expect(classes).toHaveLength(1);
    expect(classes[0].name).toBe("Server");
  });

  it("returns empty array for unsupported extension", async () => {
    const result = await extractSymbols("test.md", "# Hello");
    expect(result).toEqual([]);
  });

  it("reports correct start and end line numbers", async () => {
    const source = `// line 1
// line 2
export function hello() {
  // line 4
  return "world";
}
`;
    const result = await extractSymbols("test.ts", source);

    const func = result.find((s) => s.name === "hello");
    expect(func).toBeDefined();
    expect(func!.line).toBe(3);
    expect(func!.endLine).toBe(6);
  });

  it("extracts symbols from JavaScript", async () => {
    const source = `
function greet() {
    console.log("hi");
}

class Greeter {
    sayHello() {
        return "hello";
    }
}
`;
    const result = await extractSymbols("test.js", source);

    const functions = result.filter((s) => s.kind === "function");
    expect(functions).toHaveLength(1);
    expect(functions[0].name).toBe("greet");

    const classes = result.filter((s) => s.kind === "class");
    expect(classes).toHaveLength(1);
    expect(classes[0].name).toBe("Greeter");

    const methods = result.filter((s) => s.kind === "method");
    expect(methods).toHaveLength(1);
    expect(methods[0].name).toBe("sayHello");
    expect(methods[0].qualified).toBe("Greeter.sayHello");
  });

  it("extracts symbols from JSX files", async () => {
    const source = `
export function App() {
    return <div>Hello</div>;
}
`;
    const result = await extractSymbols("test.jsx", source);

    const functions = result.filter((s) => s.kind === "function");
    expect(functions).toHaveLength(1);
    expect(functions[0].name).toBe("App");
  });

  it("returns symbols in document order", async () => {
    const source = `
function a() {}
class B {
  method1() {}
}
function c() {}
`;
    const result = await extractSymbols("test.ts", source);

    const names = result.map((s) => s.name);
    expect(names).toEqual(["a", "B", "method1", "c"]);
  });

  it("caches parser per language so second call works", async () => {
    const source = `const x = 1;`;

    const r1 = await extractSymbols("cache1.ts", source);
    const r2 = await extractSymbols("cache2.ts", source);

    expect(r1).toBeDefined();
    expect(r2).toBeDefined();
    expect(r2.every((s) => s.file === "cache2.ts")).toBe(true);
  });
});

describe("parseFile", () => {
  it("extracts symbols and named import from TypeScript", async () => {
    const source = `import { PiHost } from "./piHost";

class App {
  start() {}
}`;
    const result = await parseFile("test.ts", source);

    expect(result.imports).toContain("PiHost");
    expect(result.symbols).toHaveLength(2); // App + start
  });

  it("extracts original name not alias from TS named import", async () => {
    const source = `import { Foo as Bar } from "./module";
function main() {}`;
    const result = await parseFile("test.ts", source);

    expect(result.imports).toContain("Foo");
    expect(result.imports).not.toContain("Bar");
  });

  it("extracts namespace import name from TypeScript", async () => {
    const source = `import * as Utils from "./utils";
class Runner {}`;
    const result = await parseFile("test.ts", source);

    expect(result.imports).toContain("Utils");
  });

  it("extracts default import name from TypeScript", async () => {
    const source = `import DefaultClass from "./module";
export function init() {}`;
    const result = await parseFile("test.ts", source);

    expect(result.imports).toContain("DefaultClass");
  });

  it("ignores bare import without symbols in TypeScript", async () => {
    const source = `import "./side-effect";
class Foo {}`;
    const result = await parseFile("test.ts", source);

    expect(result.imports).toEqual([]);
  });

  it("extracts from-import name from Python", async () => {
    const source = `from auth import TokenManager

class Auth:
    pass
`;
    const result = await parseFile("test.py", source);

    expect(result.imports).toContain("TokenManager");
  });

  it("extracts plain import module names from Python", async () => {
    const source = `import os, sys

def main():
    pass
`;
    const result = await parseFile("test.py", source);

    expect(result.imports).toEqual(
      expect.arrayContaining(["os", "sys"]),
    );
  });

  it("extracts original name not alias from Python from-import", async () => {
    const source = `from x import y as z

class A:
    pass
`;
    const result = await parseFile("test.py", source);

    expect(result.imports).toContain("y");
    expect(result.imports).not.toContain("z");
  });

  it("extracts package name from Go import path", async () => {
    const source = `package main

import "fmt"

func main() {}
`;
    const result = await parseFile("test.go", source);

    expect(result.imports).toContain("fmt");
  });

  it("extracts explicit alias from Go import spec", async () => {
    const source = `package main

import f "fmt"

func main() {}
`;
    const result = await parseFile("test.go", source);

    expect(result.imports).toContain("f");
  });

  it("extracts module from dotted Go import path", async () => {
    const source = `package main

import "net/http"

type Server struct {}
`;
    const result = await parseFile("test.go", source);

    expect(result.imports).toContain("http");
  });

  it("extracts symbols and imports from JavaScript", async () => {
    const source = `import { greet } from "./lib";

export function main() {}
`;
    const result = await parseFile("test.js", source);

    expect(result.imports).toContain("greet");
    expect(result.symbols).toHaveLength(1);
  });

  it("returns empty imports for unsupported extension", async () => {
    const result = await parseFile("test.md", "# Hello");
    expect(result.symbols).toEqual([]);
    expect(result.imports).toEqual([]);
  });
});
