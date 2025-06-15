import { parseSub, error } from "npm:tiny-ts-parser";

// 型システムの型定義
type Type =
  | { tag: "Boolean" }
  | { tag: "Number" }
  | { tag: "Func"; params: Param[]; retType: Type }
  | { tag: "Object"; props: PropertyType[] };

type PropertyType = { name: string; type: Type };

// 項の構文木
type Term =
  | { tag: "true" }
  | { tag: "false" }
  | { tag: "if"; cond: Term; thn: Term; els: Term }
  | { tag: "number"; n: number }
  | { tag: "add"; left: Term; right: Term }
  | { tag: "var"; name: string }
  | { tag: "func"; params: Param[]; body: Term }
  | { tag: "call"; func: Term; args: Term[] }
  | { tag: "seq"; body: Term; rest: Term }
  | { tag: "const"; name: string; init: Term; rest: Term }
  | { tag: "seq"; body: Term; rest: Term } // 逐次実行：まずbodyの項を実行し、それが終わったらrestの項を実行する
  | { tag: "const"; name: string; init: Term; rest: Term }
  | { tag: "objectNew"; props: PropertyTerm[] }
  | { tag: "objectGet"; obj: Term; propName: string } //x.fooのようなオブジェクトのプロパティ取得
  | {
      tag: "recFunc";
      funcName: string;
      params: Param[];
      retType: Type; // 返り値
      body: Term; // 再起を実行する
      rest: Term; // f;の部分、値そのものを参照している部分であり、その型がプログラム全体の型として返されるようにするために置く
    }; // 再帰関数 function f(x: number): number { return f(x); }; f;
type PropertyTerm = { name: string; term: Term };

type Param = { name: string; type: Type };

type TypeEnv = Record<string, Type>;

function typeEq(ty1: Type, ty2: Type): boolean {
  switch (ty2.tag) {
    case "Boolean":
      return ty1.tag === "Boolean";
    case "Number":
      return ty1.tag === "Number";
    case "Func": {
      if (ty1.tag !== "Func") return false;
      if (ty1.params.length !== ty2.params.length) return false;
      for (let i = 0; i < ty1.params.length; i++) {
        if (!typeEq(ty1.params[i].type, ty2.params[i].type)) {
          return false;
        }
      }
      if (!typeEq(ty1.retType, ty2.retType)) return false;
      return true;
    }
    case "Object": {
      if (ty1.tag !== "Object") return false;
      if (ty1.props.length !== ty2.props.length) return false;
      for (const prop2 of ty2.props) {
        const prop1 = ty1.props.find((prop1) => prop1.name === prop2.name);
        if (!prop1) return false;
        if (!typeEq(prop1.type, prop2.type)) return false;
      }
      return true;
    }
  }
}

function subtype(ty1: Type, ty2: Type): boolean {
  switch (ty2.tag) {
    case "Boolean":
      return ty1.tag === "Boolean";
    case "Number":
      return ty1.tag === "Number";
    case "Object": {
      if (ty1.tag !== "Object") return false;
      // プロパティの数を比較する必要はない
      //if (ty1.props.length !== ty2.props.length) return false;
      for (const prop2 of ty2.props) {
        // オブジェクト型ty1とオブジェクト型ty2が部分型であるとは、ty2のすべてのプロパティをty1が持っている必要がある
        const prop1 = ty1.props.find((prop1) => prop1.name === prop2.name);
        if (!prop1) return false;
        if (!subtype(prop1.type, prop2.type)) return false;
      }
      return true;
    }
    case "Func": {
      if (ty1.tag !== "Func") return false;
      //  仮引数と実引数は一致する必要がある
      if (ty1.params.length !== ty2.params.length) return false;
      for (let i = 0; i < ty1.params.length; i++) {
        if (!subtype(ty2.params[i].type, ty1.params[i].type)) {
          return false; // 反変
        }
      }
      if (!subtype(ty1.retType, ty2.retType)) return false;
      return true;
    }
  }
}

export function typecheck(t: Term, tyEnv: TypeEnv): Type {
  switch (t.tag) {
    case "true":
      return { tag: "Boolean" };
    case "false":
      return { tag: "Boolean" };
    case "if": {
      const condTy = typecheck(t.cond, tyEnv);
      if (condTy.tag !== "Boolean") error("boolean expected", t.cond);
      const thnTy = typecheck(t.thn, tyEnv);
      const elsTy = typecheck(t.els, tyEnv);
      if (!typeEq(thnTy, elsTy)) {
        error("then and else have different types", t);
      }
      return thnTy;
    }
    case "number":
      return { tag: "Number" };
    case "add": {
      const leftTy = typecheck(t.left, tyEnv);
      if (leftTy.tag !== "Number") error("number expected", t.left);
      const rightTy = typecheck(t.right, tyEnv);
      if (rightTy.tag !== "Number") error("number expected", t.right);
      return { tag: "Number" };
    }
    case "var": {
      if (tyEnv[t.name] === undefined) error(`unknown variable: ${t.name}`, t);
      return tyEnv[t.name];
    }
    case "func": {
      const newTyEnv = { ...tyEnv };
      // 型環境にパラメータの型を追加
      for (const { name, type } of t.params) {
        newTyEnv[name] = type;
      }
      const retType = typecheck(t.body, newTyEnv);
      return { tag: "Func", params: t.params, retType };
    }
    case "call": {
      const funcTy = typecheck(t.func, tyEnv);
      if (funcTy.tag !== "Func") error("function type expected", t.func);
      if (
        (
          funcTy as {
            tag: "Func";
            params: Param[];
            retType: Type;
          }
        ).params.length !== t.args.length
      ) {
        error("wrong number of arguments", t);
      }
      for (let i = 0; i < t.args.length; i++) {
        const argTy = typecheck(t.args[i], tyEnv);
        if (
          !subtype(
            argTy,
            (funcTy as { tag: "Func"; params: Param[]; retType: Type }).params[
              i
            ].type
          )
        ) {
          error("parameter type mismatch", t.args[i]);
        }
      }
      return (
        funcTy as {
          tag: "Func";
          params: Param[];
          retType: Type;
        }
      ).retType;
    }
    case "seq":
      typecheck(t.body, tyEnv);
      return typecheck(t.rest, tyEnv);
    case "const": {
      const ty = typecheck(t.init, tyEnv);
      const newTyEnv = { ...tyEnv, [t.name]: ty };
      return typecheck(t.rest, newTyEnv);
    }
    // オブジェクト生成そのものに対する判定基準はない
    case "objectNew": {
      const props = t.props.map(({ name, term }) => ({
        name,
        type: typecheck(term, tyEnv),
      }));
      return { tag: "Object", props };
    }
    case "objectGet": {
      // オブジェクトであることを確認
      const objectTy = typecheck(t.obj, tyEnv);
      if (objectTy.tag !== "Object") error("object type expected", t.obj);

      // プロパティ名が存在するか確認
      const prop = (
        objectTy as { tag: "Object"; props: PropertyType[] }
      ).props.find((prop) => prop.name === t.propName);
      if (!prop) error(`unknown property name: ${t.propName}`, t);
      return (prop as PropertyType).type;
    }
    case "recFunc": {
      const funcTy: Type = {
        tag: "Func",
        params: t.params,
        retType: t.retType,
      };
      const newTyEnv = { ...tyEnv };
      // 型環境にパラメータの型を追加
      for (const { name, type } of t.params) {
        newTyEnv[name] = type;
      }
      newTyEnv[t.funcName] = funcTy; // 再帰関数の名前を型環境に追加
      const retType = typecheck(t.body, newTyEnv);
      if (!typeEq(t.retType, retType)) error("wrong return type", t);
      const newTyEnv2 = { ...tyEnv, [t.funcName]: funcTy };
      return typecheck(t.rest, newTyEnv2);
    }
  }
}

// console.log(typecheck(parseBasic("(x: boolean) => 42"), {}));
// console.log(typecheck(parseBasic("(x: number) => x"), {}));
// console.log(parseBasic("(x: boolean) => 42"));
// console.log(parseBasic("(x: number) => x"));
// console.log(typecheck(parseBasic("( (x: number) => x )(42)"), {}));
// console.log(typecheck(parseBasic("(1 + 2); true;"), {}));
// console.log(
//   typecheck(
//     parseObj(`
//  const f = (x: number) => f(x);
//  f(0);
//  `),
//     {}
//   )
// );
// console.log(
//   typecheck(
//     parseRecFunc(`
//  function f(x: number): number { return f(x); }
//  f(0)
//  `),
//     {}
//   )
// );
console.log(
  typecheck(
    parseSub(`
 const f = (x: { foo: number }) => x.foo;
 const x = { foo: 1, bar: true };
 f(x);
 `),
    {}
  )
);
