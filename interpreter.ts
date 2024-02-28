const DELIMITERS = [" ", "\n", "(", ")", "[", "]", "{", "}", "="];
const FN = "fn";
const FN_TYPE = "Fn";
const ST = "struct";
const DOT = ".";
const RETURN_TYPE = "->";
const IF = "if";
const MATCH = "match";
const CLAUSE = [FN, ST, DOT, RETURN_TYPE, IF, MATCH];

export function interprete(text: string, env?: Environment): Environment {
  const tokens = tokenParser(text);
  const sections = new SectionParser(tokens).run();
  let syntaxs = new SyntaxParser(sections).run();

  env = env ?? new Environment();

  syntaxs = typeParser(syntaxs, env);
  console.dir(syntaxs, { depth: 10 });
  env = evaler(syntaxs, env);
  return env;
}

function dumpObj(obj: object): string {
  const props: { key: string; value: object }[] = [];
  for (const key in obj) {
    // @ts-ignore デバッグ用なので無視
    props.push({ key, value: obj[key] });
  }
  return `<${obj.constructor.name} ${props
    .map((x) => `${x.key}: ${x.value}`)
    .join(", ")}>`;
}

function skip<T>(list: T[], f: (x: T) => boolean): T[] {
  const item = list[0];
  if (item === undefined) return list;
  if (f(item)) {
    list.shift();
    return skip(list, f);
  } else {
    return list;
  }
}

function equalType(
  a: TypeValue | TypeValue[],
  b: TypeValue | TypeValue[],
): boolean {
  if (a.constructor !== b.constructor) return false;

  if (a instanceof Array) {
    b = b as TypeValue[];
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      const aa = a[i];
      const bb = b[i];
      if (!equalType(aa, bb)) return false;
    }
    return true;
  } else {
    return a.equalType(b as TypeValue);
  }
}

function uniqueType(args: TypeValue[]): TypeValue[] {
  const list = [...args];
  const result: TypeValue[] = [];
  for (;;) {
    const x = list.pop();
    if (!x) break;

    if (list.find((y) => equalType(x, y))) {
      // no operation
    } else {
      result.push(x);
    }
  }
  return result;
}

function tokenParser(text: string): Token[] {
  const tokens: Token[] = [];
  let bufferToken = "";

  for (const char of text) {
    if (DELIMITERS.includes(char)) {
      if (bufferToken !== "") {
        // バッファーに何か文字があればトークンとして追加する
        tokens.push(new Token(bufferToken));
        bufferToken = "";
      }
      if (char !== " ") {
        tokens.push(new Token(char));
      }
    } else {
      bufferToken += char;
    }
  }
  if (bufferToken !== "") {
    tokens.push(new Token(bufferToken));
  }

  return tokens;
}

class Token {
  text: string;

  constructor(text: string) {
    this.text = text;
  }

  isDelimiter(): boolean {
    return DELIMITERS.includes(this.text);
  }

  isClause(): boolean {
    return CLAUSE.includes(this.text);
  }

  isVariable(): boolean {
    return !this.isDelimiter() && !this.isClause();
  }

  split(str: string): Token[] {
    return this.text.split(str).map((x) => new Token(x));
  }

  toString(): string {
    return `"${this.text}"`;
  }
}

class Section {
  tokens: Array<Token>;

  constructor() {
    this.tokens = [];
  }

  push(token: Token): void {
    this.tokens.push(token);
  }

  next(): Token | undefined {
    return this.tokens.shift();
  }

  peek(): Token | undefined {
    return this.tokens[0];
  }

  isEmpty(): boolean {
    return this.tokens.length <= 0;
  }

  toString(): string {
    return this.tokens.map((x) => x.toString()).join(", ");
  }
}

class SectionParser {
  tokens: Token[];
  sections: Section[];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
    this.sections = [];
  }

  run(): Section[] {
    for (;;) {
      if (this.tokens.length === 0) break;
      const section = this.sectionParse();
      if (section.isEmpty()) continue;
      this.sections.push(section);
    }
    return this.sections;
  }

  sectionParse(): Section {
    const section = new Section();
    for (;;) {
      const token = this.tokens.shift();

      if (!token) break;

      if (token.text === "\n") break;

      if (["(", "[", "{"].includes(token.text)) {
        this.tokens.unshift(token);
        this.bracketParse(section);
        continue;
      }

      section.push(token);
    }
    return section;
  }

  bracketParse(section: Section): void {
    const firstToken = this.tokens.shift();
    if (!firstToken) {
      throw new Error(
        `必ず括弧のトークンが入っているはず。token=${firstToken}`,
      );
    }
    if (!["(", "[", "{"].includes(firstToken.text)) {
      throw new Error(
        `必ず括弧のトークンが入っているはず。token=${firstToken}`,
      );
    }
    section.push(firstToken);

    for (;;) {
      const token = this.tokens.shift();

      if (!token) return;

      if (firstToken.text === "(" && token.text === ")") {
        section.push(token);
        return;
      }
      if (firstToken.text === "[" && token.text === "]") {
        section.push(token);
        return;
      }
      if (firstToken.text === "{" && token.text === "}") {
        section.push(token);
        return;
      }

      if (["(", "[", "{"].includes(token.text)) {
        this.tokens.unshift(token);
        this.bracketParse(section);
        continue;
      }

      section.push(token);
    }
  }
}

abstract class Syntax {
  type: TypeValue | undefined = undefined;

  abstract eval(env: Environment): LValue;
  abstract typeEval(env: Environment): TypeValue;

  toString(): string {
    return dumpObj(this);
  }
}

class VarDefSyntax extends Syntax {
  name: Token;
  value: Syntax;

  constructor(name: Token, value: Syntax) {
    super();
    this.name = name;
    this.value = value;
  }

  typeEval(env: Environment): TypeValue {
    if (env.compileScope.has(this.name.text)) {
      throw new Error(
        `${this.name.text}は既に定義されています。token=${this.name}`,
      );
    }

    this.type = this.value.typeEval(env);
    env.compileScope.set(this.name.text, this.type);
    return this.type;
  }

  eval(env: Environment): LValue {
    const value = this.value.eval(env);

    if (env.scope.has(this.name.text)) {
      throw new Error(`既に${this.name.text}は定義されているため使えません。`);
    }

    env.scope.set(this.name.text, value);

    return value;
  }
}

class FnDefSyntax extends Syntax {
  args: FnArgSyntax[];
  returnType: TypeSyntax;
  body: Syntax[];

  constructor(args: FnArgSyntax[], returnType: TypeSyntax, body: Syntax[]) {
    super();
    this.args = args;
    this.returnType = returnType;
    this.body = body;
  }

  typeEval(env: Environment): FnTypeValue {
    const retDef = this.returnType.typeEval(env);

    env.compileScope.create();

    this.args.forEach((x) => {
      env.compileScope.set(x.name.text, x.fieldType.typeEval(env));
    });

    const retBody = this.body.reduce(
      (_, x) => x.typeEval(env),
      env.buildinType.Null,
    );

    env.compileScope.delete();

    if (!equalType(retDef, retBody)) {
      throw new Error(
        `宣言されている返り値の型(${retDef})と実際の返り値の型(${retBody})が違います`,
      );
    }

    const result = new FnTypeValue(
      this.args.map((x) => x.fieldType.typeEval(env)),
      retDef,
    );
    this.type = result;
    return result;
  }

  eval(env: Environment): LValue {
    const args = this.args.map((x) => x.eval(env));
    const type = this.returnType.eval(env);

    if (!(type instanceof TypeValue)) {
      throw new Error(
        `返り値のデータ型にデータ型ではない値を入れています。value=${type}`,
      );
    }

    return new FnUserValue(args, type, this.body);
  }
}

class FnArgSyntax {
  name: Token;
  fieldType: TypeSyntax;

  constructor(name: Token, type: TypeSyntax) {
    this.name = name;
    this.fieldType = type;
  }

  eval(env: Environment): FnArgValue {
    const type = this.fieldType.eval(env);
    if (!(type instanceof TypeValue)) {
      throw new Error(
        `引数のデータ型にデータ型ではない値を入れています。value=${type}, token=${this.fieldType.name}`,
      );
    }
    return new FnArgValue(this.name.text, type);
  }
}

class FnCallSyntax extends Syntax {
  name: Token;
  args: Syntax[];

  constructor(name: Token, args: Syntax[]) {
    super();
    this.name = name;
    this.args = args;
  }

  typeEval(env: Environment): TypeValue {
    const f = env.compileScope.get(this.name.text);
    if (!f) throw new Error(`関数が見つかりません。token=${this.name}`);

    const argTypes = this.args.map((x) => x.typeEval(env));

    if (f instanceof FnTypeValue) {
      if (argTypes.length !== f.args.length) {
        throw new Error(`引数の数が一致しません。token=${this.name}`);
      }
      for (let i = 0; i < argTypes.length; i++) {
        const define = f.args[i];
        const actual = argTypes[i];

        if (define.primitive === PrimitiveType.Any) continue;

        if (actual.primitive === PrimitiveType.Any) {
          throw new Error(
            `${this.name}の${
              i + 1
            }番目の引数が${PrimitiveType.Any}型になっています。`,
          );
        }

        if (!equalType(define, actual)) {
          throw new Error(
            `${this.name}の${
              i + 1
            }番目の引数の型が一致しません。define=${define}, actual=${actual}`,
          );
        }
      }

      this.type = f.returnType;
      return this.type;
    }

    if (f instanceof StructTypeValue) {
      this.type = f;
      return this.type;
    }

    if (f instanceof GenericTypeValue) {
      this.type = f.createType(argTypes);
      return this.type;
    }

    throw new Error(`関数が見つかりません。token=${this.name}`);
  }

  eval(env: Environment): LValue {
    const f = env.scope.get(this.name.text);
    if (!f) throw new Error(`関数が見つかりません。token=${this.name}`);

    if (f instanceof FnValue) {
      if (this.args.length !== f.defArgs.length) {
        throw new Error(
          `引数の数があっていません。function=${f}, args=${this.args}`,
        );
      }

      return f.call(
        env,
        this.args.map((x) => x.eval(env)),
      );
    }

    if (f instanceof StructTypeValue) {
      return f.createInstance(this.args.map((x) => x.eval(env)));
    }

    if (f instanceof GenericTypeValue) {
      return f.createType(
        this.args.map((x) => {
          const type = x.eval(env);
          if (!(type instanceof TypeValue)) {
            throw new Error(`データ型のみです。syntax=${x}`);
          }
          return type;
        }),
      );
    }

    throw new Error(`関数が見つかりません。token=${this.name}`);
  }
}

class StructDefSyntax extends Syntax {
  fields: StructFieldSyntax[];

  constructor(field: StructFieldSyntax[]) {
    super();
    this.fields = field;
  }

  typeEval(env: Environment): StructTypeValue {
    const result = new StructTypeValue(this.fields.map((x) => x.typeEval(env)));
    this.type = result;
    return result;
  }

  eval(env: Environment): StructTypeValue {
    return new StructTypeValue(this.fields.map((x) => x.eval(env)));
  }
}

class StructFieldSyntax {
  name: Token;
  fieldType: TypeSyntax;

  constructor(name: Token, fieldType: TypeSyntax) {
    this.name = name;
    this.fieldType = fieldType;
  }

  typeEval(env: Environment): StructFieldValue {
    const result = new StructFieldValue(
      this.name.text,
      this.fieldType.typeEval(env),
    );
    return result;
  }

  eval(env: Environment): StructFieldValue {
    const type = this.fieldType.eval(env);
    if (!(type instanceof TypeValue)) {
      throw new Error(
        `構造体フィールドのデータ型にデータ型ではない値を入れています。value=${type}, token=${this.fieldType.name}`,
      );
    }
    return new StructFieldValue(this.name.text, type);
  }
}

class VarCallSyntax extends Syntax {
  name: Token;

  constructor(name: Token) {
    super();
    this.name = name;
  }

  typeEval(env: Environment): TypeValue {
    const v = env.compileScope.get(this.name.text);
    if (!v) {
      throw new Error(`${this.name.text}は見つかりません。token=${this.name}`);
    }
    this.type = v;
    return this.type;
  }

  eval(env: Environment): LValue {
    const result = env.scope.get(this.name.text);
    if (!result) {
      throw new Error(`${this.name.text}は見つかりません。token=${this.name}`);
    }
    return result;
  }
}

class StructFieldCallSyntax extends Syntax {
  parent: Token;
  child: Token | StructFieldCallSyntax;

  constructor(parent: Token, child: Token | StructFieldCallSyntax) {
    super();
    this.parent = parent;
    this.child = child;
  }

  typeEval(env: Environment): TypeValue {
    const s = env.compileScope.get(this.parent.text);
    if (!s) {
      throw new Error(
        `${this.parent.text}は見つかりませんでした。token=${this.parent}`,
      );
    }
    if (!(s instanceof StructTypeValue)) {
      throw new Error(
        `${this.parent.text}は構造体ではありません。token=${this.parent}`,
      );
    }

    const result = this.recurseTypeEval(s);
    this.type = result;
    return result;
  }

  recurseTypeEval(s: StructTypeValue): TypeValue {
    const f = s.fields.find((x) => x.name === this.parent.text);
    if (!f) {
      throw new Error(
        `${this.parent.text}は見つかりませんでした。token=${this.parent}`,
      );
    }
    if (!(f.fieldType instanceof StructTypeValue)) {
      throw new Error(
        `${this.parent.text}は構造体ではありません。token=${this.parent}`,
      );
    }

    const ss = f.fieldType;
    if (this.child instanceof Token) {
      // LSP のバグっぽいため as をつけている
      const ff = ss.fields.find((x) => x.name === (this.child as Token).text);
      if (!ff) {
        throw new Error(
          `${this.child.text}は構造体のフィールド名ではありません。token=${this.child}`,
        );
      }
      this.type = ff.fieldType;
      return ff.fieldType;
    } else {
      const result = this.recurseTypeEval(ss);
      this.type = result;
      return result;
    }
  }

  eval(env: Environment): LValue {
    const structIns = env.scope.get(this.parent.text);
    if (!structIns) {
      throw new Error(`${this.parent.text}は見つかりませんでした。`);
    }
    if (!(structIns instanceof StructInstanceValue)) {
      throw new Error(
        `${this.parent.text}は構造体ではありません。token=${this.parent}`,
      );
    }

    if (this.child instanceof Token) {
      return structIns.get(this.child.text);
    } else {
      return this.child.recurseEval(structIns);
    }
  }

  recurseEval(s: StructInstanceValue): LValue {
    const ss = s.get(this.parent.text);
    if (!(ss instanceof StructInstanceValue)) {
      throw new Error(
        `${this.parent.text}は構造体ではありません。token=${this.parent}`,
      );
    }

    if (this.child instanceof Token) {
      return ss.get(this.child.text);
    } else {
      return this.child.recurseEval(ss);
    }
  }
}

class NumberSyntax extends Syntax {
  value: Token;

  constructor(value: Token) {
    super();
    this.value = value;
  }

  typeEval(env: Environment): TypeValue {
    this.type = env.buildinType.Num;
    return this.type;
  }

  eval(_env: Environment): LValue {
    return new NumValue(Number(this.value.text));
  }
}

class BoolSyntax extends Syntax {
  value: Token;

  constructor(value: Token) {
    super();
    this.value = value;
  }

  typeEval(env: Environment): TypeValue {
    this.type = env.buildinType.Bool;
    return this.type;
  }

  eval(_env: Environment): LValue {
    return new BoolValue(this.value.text === "true");
  }
}

class NullSyntax extends Syntax {
  value: Token;

  constructor(value: Token) {
    super();
    this.value = value;
  }

  typeEval(env: Environment): TypeValue {
    this.type = env.buildinType.Null;
    return this.type;
  }

  eval(_env: Environment): LValue {
    return LNull;
  }
}

abstract class TypeSyntax extends Syntax {
  name: Token;

  constructor(name: Token) {
    super();
    this.name = name;
  }

  abstract eval(env: Environment): TypeValue;
}

class PrimitiveTypeSyntax extends TypeSyntax {
  constructor(name: Token) {
    super(name);
  }

  typeEval(env: Environment): TypeValue {
    const value = env.compileScope.get(this.name.text);
    if (!value) {
      throw new Error(`${this.name.text}は見つかりません。token=${this.name}`);
    }
    this.type = value;
    return this.type;
  }

  eval(env: Environment): TypeValue {
    const result = env.scope.get(this.name.text);
    if (!result) {
      throw new Error(
        `${this.name.text}は見つかりませんでした。token=${this.name}`,
      );
    }
    if (!(result instanceof TypeValue)) {
      throw new Error(
        `${this.name.text}はデータ型ではありません。value=${result}`,
      );
    }
    return result;
  }
}

class ConstructorTypeSyntax extends TypeSyntax {
  args: TypeSyntax[];

  constructor(name: Token, args: TypeSyntax[]) {
    super(name);
    this.args = args;
  }

  typeEval(env: Environment): ConstructorTypeValue {
    const generic = env.compileScope.get(this.name.text);
    if (!generic) {
      throw new Error(`${this.name.text}は見つかりません。token=${this.name}`);
    }
    if (!(generic instanceof GenericTypeValue)) {
      throw new Error(
        `${this.name.text}はジェネリック型ではありません。token=${this.name}`,
      );
    }

    const args = this.args.map((x) => x.typeEval(env));
    const result = generic.createType(args);
    this.type = result;
    return result;
  }

  eval(env: Environment): TypeValue {
    const generic = env.scope.get(this.name.text);
    if (!generic) {
      throw new Error(`${this.name.text}は見つかりません。token=${this.name}`);
    }
    if (!(generic instanceof GenericTypeValue)) {
      throw new Error(
        `${this.name.text}はジェネリック型ではありません。token=${this.name}`,
      );
    }

    const args = this.args.map((x) => {
      const type = x.eval(env);
      if (!(type instanceof TypeValue)) {
        throw new Error(
          `ジェネリック型のコンストラクタの引数にはデータ型のみです。token=${x.name}`,
        );
      }
      return type;
    });

    return generic.createType(args);
  }
}

class FnTypeConstructorSyntax extends TypeSyntax {
  args: TypeSyntax[];
  returnType: TypeSyntax;

  constructor(name: Token, args: TypeSyntax[], returnType: TypeSyntax) {
    super(name);
    this.args = args;
    this.returnType = returnType;
  }

  typeEval(env: Environment): FnTypeValue {
    const result = new FnTypeValue(
      this.args.map((x) => x.typeEval(env)),
      this.returnType.typeEval(env),
    );
    this.type = result;
    return result;
  }

  eval(env: Environment): FnTypeValue {
    const args = this.args.map((x) => {
      const type = x.eval(env);
      if (!(type instanceof TypeValue)) {
        throw new Error(
          `データ型ではない値を入れています。value=${type}, token=${x.name}`,
        );
      }
      return type;
    });

    const returnType = this.returnType.eval(env);
    if (!(returnType instanceof TypeValue)) {
      throw new Error(
        `データ型ではない値を入れています。value=${returnType}, token=${this.returnType.name}`,
      );
    }
    return new FnTypeValue(args, returnType);
  }
}

class IfSyntax extends Syntax {
  condition: Syntax;
  thenClause: Syntax[];
  elseClause: Syntax[] | undefined;

  constructor(condition: Syntax, thenClause: Syntax[], elseClause?: Syntax[]) {
    super();
    this.condition = condition;
    this.thenClause = thenClause;
    this.elseClause = elseClause;
  }

  typeEval(env: Environment): TypeValue {
    this.condition.typeEval(env);

    env.compileScope.create();
    const thenType = this.thenClause.reduce(
      (_, x) => x.typeEval(env),
      env.buildinType.Null,
    );
    env.compileScope.delete();

    let elseType: TypeValue | undefined = undefined;
    if (this.elseClause !== undefined) {
      env.compileScope.create();
      elseType = this.elseClause.reduce(
        (_, x) => x.typeEval(env),
        env.buildinType.Null,
      );
      env.compileScope.delete();
    }

    if (elseType === undefined) {
      this.type = thenType;
      return this.type;
    } else {
      return OrTypeValue.create([thenType, elseType]);
    }
  }

  eval(env: Environment): LValue {
    const c = this.condition.eval(env);

    // false の時
    if (
      c instanceof NullValue ||
      (c instanceof BoolValue && c.value === false)
    ) {
      if (this.elseClause === undefined) {
        return LNull;
      } else {
        env.scope.create();
        const result = this.elseClause.reduce((_, x) => x.eval(env), LNull);
        env.scope.delete();
        return result;
      }
    }

    // true の時
    env.scope.create();
    const result = this.thenClause.reduce((_, x) => x.eval(env), LNull);
    env.scope.delete();
    return result;
  }
}

class MatchSyntax extends Syntax {
  variable: Syntax;
  cases: MatchCase[];
  elseCase: MatchElseCase | undefined;

  constructor(v: Syntax, c: MatchCase[], e: MatchElseCase | undefined) {
    super();
    this.variable = v;
    this.cases = c;
    this.elseCase = e;
  }

  typeEval(env: Environment): TypeValue {
    const originType = this.variable.typeEval(env);

    // sets の処理
    const resultTypes: TypeValue[] = [];

    this.cases.forEach((c) => {
      env.compileScope.create();
      env.compileScope.set(c.arg.text, c.type.typeEval(env));
      const type = c.body.reduce(
        (_, x) => x.typeEval(env),
        env.buildinType.Null,
      );
      resultTypes.push(type);
      env.compileScope.delete();
    });

    // else 部分の処理
    if (this.elseCase !== undefined) {
      env.compileScope.create();
      env.compileScope.set(this.elseCase.arg.text, originType);
      const elseType = this.elseCase.body.reduce(
        (_, x) => x.typeEval(env),
        env.buildinType.Null,
      );
      resultTypes.push(elseType);
      env.compileScope.delete();
    } else {
      resultTypes.push(env.buildinType.Null);
    }

    this.type = OrTypeValue.create(resultTypes);
    return this.type;
  }

  eval(env: Environment): LValue {
    const v = this.variable.eval(env);

    for (const c of this.cases) {
      if (equalType(c.type.eval(env), v.toType())) {
        env.scope.create();
        env.scope.set(c.arg.text, v);
        const result = c.body.reduce((_, x) => x.eval(env), LNull);
        env.scope.delete();
        return result;
      }
    }

    if (this.elseCase !== undefined) {
      env.scope.create();
      env.scope.set(this.elseCase.arg.text, v);
      const result = this.elseCase.body.reduce((_, x) => x.eval(env), LNull);
      env.scope.delete();
      return result;
    } else {
      return LNull;
    }
  }
}

class MatchCase {
  type: TypeSyntax;
  arg: Token;
  body: Syntax[];

  constructor(t: TypeSyntax, a: Token, b: Syntax[]) {
    this.type = t;
    this.arg = a;
    this.body = b;
  }
}

class MatchElseCase {
  arg: Token;
  body: Syntax[];

  constructor(a: Token, b: Syntax[]) {
    this.arg = a;
    this.body = b;
  }
}

// syntax          | top parse | round brackets parse | one value parse
// --------------- | --------- | -------------------- | ----------------------
// round brackets  | true      | true                 | true
// function define | true      | true                 | false (by round brackets)
// struct define   | true      | true                 | false (by round brackets)
// if              | true      | true                 | false (by round brackets)
// match           | true      | true                 | false (by round brackets)
// null literal    | true      | true                 | true
// bool literal    | true      | true                 | true
// number literal  | true      | true                 | true
// variable define | true      | true                 | false (by round brackets)
// variable call   | true      | false                | true
// function call   | true (*)  | true                 | false (by round brackets)
//
// (*) - 引数がない関数を呼び出したい場合、(func_name) と書く必要あり
class SyntaxParser {
  sections: Section[];

  constructor(sections: Section[]) {
    this.sections = sections;
  }

  run(): Syntax[] {
    return this.sections.map((x) => {
      return this.topParse(x.tokens);
    });
  }

  topParse(tokens: Token[]): Syntax {
    let result: Syntax | undefined = undefined;

    result = this.roundBracketsParse(tokens);
    if (result !== undefined) return result;

    result = this.fnDefParse(tokens);
    if (result !== undefined) return result;

    result = this.structDefParse(tokens);
    if (result !== undefined) return result;

    result = this.ifParse(tokens);
    if (result !== undefined) return result;

    result = this.matchParse(tokens);
    if (result !== undefined) return result;

    result = this.nullParse(tokens);
    if (result !== undefined) return result;

    result = this.boolParse(tokens);
    if (result !== undefined) return result;

    result = this.numberParse(tokens);
    if (result !== undefined) return result;

    result = this.varDefParse(tokens);
    if (result !== undefined) return result;

    if (2 <= tokens.length) {
      result = this.fnCallParse(tokens);
      if (result !== undefined) return result;
    } else {
      result = this.varCallParse(tokens);
      if (result !== undefined) return result;
    }

    throw new Error(`どの構文にも当てはまらない文章です。tokens=${tokens}`);
  }

  roundBracketsParse(tokens: Token[]): Syntax | undefined {
    if (tokens[0].text !== "(") return undefined;
    tokens.shift();

    const content: Token[] = [];
    for (;;) {
      const token = tokens.shift();
      if (!token) throw new Error(`)で閉じる必要があります。tokens=${tokens}`);
      if (token.text === ")") break;
      content.push(token);
    }
    return this.roundBracketsContentParse(content);
  }

  roundBracketsContentParse(tokens: Token[]): Syntax {
    let result: Syntax | undefined = undefined;

    result = this.roundBracketsParse(tokens);
    if (result !== undefined) return result;

    result = this.fnDefParse(tokens);
    if (result !== undefined) return result;

    result = this.structDefParse(tokens);
    if (result !== undefined) return result;

    result = this.ifParse(tokens);
    if (result !== undefined) return result;

    result = this.matchParse(tokens);
    if (result !== undefined) return result;

    result = this.nullParse(tokens);
    if (result !== undefined) return result;

    result = this.boolParse(tokens);
    if (result !== undefined) return result;

    result = this.numberParse(tokens);
    if (result !== undefined) return result;

    result = this.varDefParse(tokens);
    if (result !== undefined) return result;

    result = this.fnCallParse(tokens);
    if (result !== undefined) return result;

    throw new Error(`どの構文にも当てはまらない文章です。tokens=${tokens}`);
  }

  varDefParse(tokens: Token[]): VarDefSyntax | undefined {
    if (!tokens[1]) return undefined;
    if (tokens[1].text !== "=") return undefined;

    const name = tokens.shift();
    if (!name || !name.isVariable()) {
      throw new Error(`名前であるべき。token=${name}`);
    }

    const assign = tokens.shift();
    if (!assign || assign.text !== "=") {
      throw new Error(`代入トークンであるべき。token=${assign}`);
    }

    const value = this.topParse(tokens);
    if (!value) throw new Error(`値があるべき。token=${value}`);

    return new VarDefSyntax(name, value);
  }

  fnDefParse(tokens: Token[]): FnDefSyntax | undefined {
    if (tokens[0].text !== FN) return undefined;

    // 関数句の処理
    const fn = tokens.shift();
    if (!fn || fn.text !== FN) throw new Error(`${FN}であるべき。token=${fn}`);

    // 引数の処理
    const args: FnArgSyntax[] = [];
    for (;;) {
      const token = tokens[0];
      if (!token) throw new Error(`引数などが存在するべき。token=${token}`);
      if (token.text === RETURN_TYPE) break;

      const name = tokens.shift();
      if (!name || !name.isVariable()) {
        throw new Error(
          `引数名が存在するべき。name=${token}, tokens=${tokens}`,
        );
      }
      const type = this.typeParse(tokens);

      args.push(new FnArgSyntax(name, type));
    }

    // 返り値のデータ型の処理
    const clause = tokens.shift();
    if (!clause || clause.text !== RETURN_TYPE) {
      throw new Error(`${RETURN_TYPE}であるべき。token=${clause}`);
    }
    const returnType = this.typeParse(tokens);

    // 関数のボディの処理
    const start = tokens.shift();
    if (!start || start.text !== "{") {
      throw new Error(`{であるべき。token=${start}`);
    }
    const bodyTokens: Token[] = [];
    for (;;) {
      const token = tokens.shift();
      if (!token) throw new Error(`}で閉じる必要があります。`);
      if (token.text === "}") break;
      bodyTokens.push(token);
    }
    const sections = new SectionParser(bodyTokens).run();
    const body = new SyntaxParser(sections).run();

    return new FnDefSyntax(args, returnType, body);
  }

  typeParse(tokens: Token[]): TypeSyntax {
    let result: TypeSyntax | undefined = undefined;

    result = this.fnTypeConstrucorParse(tokens);
    if (result) return result;

    result = this.constructorTypeParse(tokens);
    if (result) return result;

    result = this.primitiveTypeParse(tokens);
    if (result) return result;

    throw new Error(`データ型として解釈できません。tokens=${tokens}`);
  }

  primitiveTypeParse(tokens: Token[]): PrimitiveTypeSyntax | undefined {
    if (!tokens[0].isVariable()) return undefined;

    const name = tokens.shift();
    if (!name) throw new Error(`never`);

    return new PrimitiveTypeSyntax(name);
  }

  constructorTypeParse(tokens: Token[]): ConstructorTypeSyntax | undefined {
    if (tokens[0]?.text !== "(") return undefined;
    const start = tokens.shift();

    const name = tokens.shift();
    if (!name) throw new Error(`)で閉じる必要があります。token=${start}`);
    if (!name.isVariable()) {
      throw new Error(`データ型名として不適切です。token=${name}`);
    }

    const args: TypeSyntax[] = [];
    for (;;) {
      const token = tokens[0];
      if (!token) throw new Error(`)で閉じる必要があります。token=${start}`);
      if (token.text === ")") break;
      args.push(this.typeParse(tokens));
    }
    tokens.shift();

    return new ConstructorTypeSyntax(name, args);
  }

  fnTypeConstrucorParse(tokens: Token[]): FnTypeConstructorSyntax | undefined {
    if (tokens[0]?.text !== "(") return undefined;
    if (tokens[1]?.text !== FN_TYPE) return undefined;
    tokens.shift();

    const name = tokens.shift();
    if (!name) throw new Error(`${FN_TYPE}が必要です。tokens=${tokens}`);

    const args: TypeSyntax[] = [];
    for (;;) {
      if (!tokens[0]) throw new Error(`)で閉じる必要があります。`);
      if ((tokens[0].text as string) === RETURN_TYPE) break;

      args.push(this.typeParse(tokens));
    }

    const returnSymbol = tokens.shift();
    if (returnSymbol?.text !== RETURN_TYPE) {
      throw new Error(`${RETURN_TYPE}であるべきです。tokens=${tokens}`);
    }

    const returnType = this.typeParse(tokens);

    const close = tokens.shift();
    if (close?.text !== ")") throw new Error(`)であるべきです。token=${close}`);

    return new FnTypeConstructorSyntax(name, args, returnType);
  }

  fnCallParse(tokens: Token[]): FnCallSyntax | undefined {
    if (!tokens[0].isVariable()) return undefined;

    const name = tokens.shift();
    if (!name || !name.isVariable()) throw new Error(`関数名であるべき。`);

    const args: Syntax[] = [];
    for (;;) {
      if (tokens.length === 0) break;
      const syntax = this.oneValueParse(tokens);
      args.push(syntax);
    }

    return new FnCallSyntax(name, args);
  }

  oneValueParse(tokens: Token[]): Syntax {
    let result: Syntax | undefined = undefined;

    result = this.roundBracketsParse(tokens);
    if (result !== undefined) return result;

    result = this.nullParse(tokens);
    if (result !== undefined) return result;

    result = this.boolParse(tokens);
    if (result !== undefined) return result;

    result = this.numberParse(tokens);
    if (result !== undefined) return result;

    result = this.varCallParse(tokens);
    if (result !== undefined) return result;

    throw new Error(`どの構文にも当てはまらない文章です。tokens=${tokens}`);
  }

  structDefParse(tokens: Token[]): StructDefSyntax | undefined {
    if (tokens[0].text !== ST) return undefined;
    tokens.shift();

    const start = tokens.shift();
    if (!start || start.text !== "{") {
      throw new Error(`{であるべきです。token=${start}`);
    }

    const fields: StructFieldSyntax[] = [];
    for (;;) {
      skip(tokens, (x) => x.text === "\n");

      const token = tokens[0];
      if (!token) throw new Error(`}で閉じる必要があります。tokens=${tokens}`);
      if (token.text === "}") break;

      const name = tokens.shift();
      if (!name || !name.isVariable()) {
        throw new Error(`構造体の名前であるべきです。token=${name}`);
      }

      const type = this.typeParse(tokens);

      fields.push(new StructFieldSyntax(name, type));
    }
    return new StructDefSyntax(fields);
  }

  ifParse(tokens: Token[]): IfSyntax | undefined {
    if (IF !== tokens[0].text) return undefined;
    tokens.shift();

    // 評価部分の処理
    const condition = this.oneValueParse(tokens);

    // then 部分の処理
    let start = tokens.shift();
    if (!start || start.text !== "{") {
      throw new Error(`{であるべきです。token=${start}`);
    }

    const thenTokens: Token[] = [];
    for (;;) {
      const token = tokens.shift();
      if (!token) throw new Error(`}で閉じる必要があります。token=${start}`);
      if (token.text === "}") break;
      thenTokens.push(token);
    }
    const thenSections = new SectionParser(thenTokens).run();
    const thenSyntaxs = new SyntaxParser(thenSections).run();

    // else 部分の処理
    // @ts-ignore maybe a bug in LSP
    if (tokens[0].text !== "{") return new IfSyntax(condition, thenSyntaxs);

    start = tokens.shift();
    const elseTokens: Token[] = [];
    for (;;) {
      const token = tokens.shift();
      if (!token) throw new Error(`}で閉じる必要があります。token=${start}`);
      if (token.text === "}") break;
      elseTokens.push(token);
    }
    const elseSections = new SectionParser(elseTokens).run();
    const elseSyntaxs = new SyntaxParser(elseSections).run();

    return new IfSyntax(condition, thenSyntaxs, elseSyntaxs);
  }

  matchParse(tokens: Token[]): MatchSyntax | undefined {
    if (MATCH !== tokens[0].text) return undefined;
    tokens.shift();

    const value = this.oneValueParse(tokens);

    const start = tokens.shift();
    if (start === undefined) throw new Error(`{で始まる必要があります`);
    if (start.text !== "{") {
      throw new Error(`{で始まる必要があります。token=${start}`);
    }
    const cases: MatchCase[] = [];
    let elseCase: MatchElseCase | undefined = undefined;
    for (;;) {
      skip(tokens, (x) => x.text === "\n");
      const token = tokens[0];
      if (token === undefined) throw new Error(`}で閉じる必要があります。`);
      if (token.text === "}") {
        tokens.shift();
        break;
      }

      // データ型部分の処理
      let t: Token | TypeSyntax;
      if (token.text === "else") {
        t = token;
        tokens.shift();
      } else {
        t = this.typeParse(tokens);
      }

      // 引数部分の処理
      const v = tokens.shift();
      if (v === undefined) throw new Error(`変数名である必要があります。`);
      if (!v.isVariable()) {
        throw new Error(`変数名として不適切です。token=${v}`);
      }

      // body 部分の処理
      const start = tokens.shift();
      if (start === undefined) throw new Error(`{で始まる必要があります。`);
      if (start.text !== "{") {
        throw new Error(`{で始まる必要があります。token=${start}`);
      }
      const bodyTokens: Token[] = [];
      for (;;) {
        const t = tokens.shift();
        if (t === undefined) throw new Error(`}で閉じる必要があります。`);
        if (t.text === "}") break;
        bodyTokens.push(t);
      }
      const bodySyntaxs = new SyntaxParser(
        new SectionParser(bodyTokens).run(),
      ).run();

      if (t instanceof TypeSyntax) {
        cases.push(new MatchCase(t, v, bodySyntaxs));
      } else {
        if (elseCase !== undefined) {
          throw new Error(`else が２回定義されてしまっています。token=${t}`);
        }
        elseCase = new MatchElseCase(v, bodySyntaxs);
      }
    }

    return new MatchSyntax(value, cases, elseCase);
  }

  nullParse(tokens: Token[]): NullSyntax | undefined {
    if ("null" !== tokens[0].text) return undefined;
    return new NullSyntax(tokens.shift()!);
  }
  boolParse(tokens: Token[]): BoolSyntax | undefined {
    if (!/^true|false$/.test(tokens[0].text)) return undefined;
    return new BoolSyntax(tokens.shift()!);
  }
  numberParse(tokens: Token[]): NumberSyntax | undefined {
    if (!/^[+,-]?\d+(\.\d+)?$/.test(tokens[0].text)) return undefined;
    return new NumberSyntax(tokens.shift()!);
  }

  varCallParse(
    tokens: Token[],
  ): VarCallSyntax | StructFieldCallSyntax | undefined {
    if (!tokens[0]) return undefined;
    if (!tokens[0].isVariable()) return undefined;
    const token = tokens.shift()!;

    if (token.text.includes(".")) {
      return this.structFieldCallParse(token.split("."));
    } else {
      return new VarCallSyntax(token);
    }
  }

  structFieldCallParse(tokens: Token[]): StructFieldCallSyntax {
    const parent = tokens.shift();
    if (!parent) throw new Error(`tokensが空です。`);

    if (tokens.length === 1) {
      return new StructFieldCallSyntax(parent, tokens[0]);
    } else {
      return new StructFieldCallSyntax(
        parent,
        this.structFieldCallParse(tokens),
      );
    }
  }
}

function typeParser(syntaxs: Syntax[], env: Environment): Syntax[] {
  syntaxs.forEach((x) => x.typeEval(env));
  return syntaxs;
}

const enum PrimitiveType {
  Any = "Any",
  Type = "Type",
  Num = "Num",
  Bool = "Bool",
  Null = "Null",
}

abstract class LValue {
  toString(): string {
    return dumpObj(this);
  }

  abstract toType(): TypeValue;
}

class NullValue extends LValue {
  toType(): PrimitiveTypeValue {
    return BUILDIN_TYPES.Null;
  }
}
const LNull = new NullValue();

class BoolValue extends LValue {
  value: boolean;

  constructor(value: boolean) {
    super();
    this.value = value;
  }

  toType(): PrimitiveTypeValue {
    return BUILDIN_TYPES.Bool;
  }
}

class NumValue extends LValue {
  value: number;

  constructor(value: number) {
    super();
    this.value = value;
  }

  toType(): PrimitiveTypeValue {
    return BUILDIN_TYPES.Num;
  }
}

abstract class TypeValue extends LValue {
  primitive: PrimitiveType;

  constructor(p: PrimitiveType) {
    super();
    this.primitive = p;
  }

  abstract equalType(other: TypeValue): boolean;
}

abstract class ConstructorTypeValue extends TypeValue {
  abstract createInstance(args: LValue[]): LValue;
}

abstract class GenericTypeValue extends TypeValue {
  abstract createType(args: TypeValue[]): ConstructorTypeValue;
}

class PrimitiveTypeValue extends TypeValue {
  equalType(other: PrimitiveTypeValue): boolean {
    if (other.constructor !== PrimitiveTypeValue) {
      throw new Error(`type が揃っていません。other = ${other} `);
    }
    return this.primitive === other.primitive;
  }

  toType(): PrimitiveTypeValue {
    return BUILDIN_TYPES.Type;
  }
}

class FnTypeValue extends TypeValue {
  args: TypeValue[];
  returnType: TypeValue;

  constructor(args: TypeValue[], returnType: TypeValue) {
    super(PrimitiveType.Type);
    this.args = args;
    this.returnType = returnType;
  }

  equalType(other: FnTypeValue): boolean {
    if (other.constructor !== FnTypeValue) {
      throw new Error(`type が揃っていません。other = ${other} `);
    }

    if (!equalType(this.returnType, other.returnType)) return false;

    return equalType(this.args, other.args);
  }

  toType(): PrimitiveTypeValue {
    return BUILDIN_TYPES.Type;
  }
}

class StructTypeValue extends ConstructorTypeValue {
  fields: StructFieldValue[];

  constructor(fields: StructFieldValue[]) {
    super(PrimitiveType.Type);
    this.fields = fields;
  }

  createInstance(args: LValue[]): StructInstanceValue {
    const map: Map<string, LValue> = new Map();

    this.fields.forEach((x, i) => {
      const value = args[i] ?? LNull;
      map.set(x.name, value);
    });

    return new StructInstanceValue(this.fields, map);
  }

  equalType(other: StructTypeValue): boolean {
    if (other.constructor !== StructTypeValue) {
      throw new Error(`type が揃っていません。other = ${other} `);
    }

    return equalType(
      this.fields.map((x) => x.fieldType),
      other.fields.map((x) => x.fieldType),
    );
  }

  toType(): PrimitiveTypeValue {
    return BUILDIN_TYPES.Type;
  }
}

class StructInstanceValue extends LValue {
  fields: StructFieldValue[];
  map: Map<string, LValue>;

  constructor(fields: StructFieldValue[], map: Map<string, LValue>) {
    super();
    this.fields = fields;
    this.map = map;
  }

  get(key: string): LValue {
    const result = this.map.get(key);
    if (!result) {
      throw new Error(`${key} は存在しないフィールドです。struct = ${this} `);
    }
    return result;
  }

  toType(): StructTypeValue {
    return new StructTypeValue(this.fields);
  }
}

class StructFieldValue {
  name: string;
  fieldType: TypeValue;

  constructor(name: string, fieldType: TypeValue) {
    this.name = name;
    this.fieldType = fieldType;
  }
}

class OrGenericTypeValue extends GenericTypeValue {
  constructor() {
    super(PrimitiveType.Type);
  }

  createType(args: TypeValue[]): OrTypeValue {
    return new OrTypeValue(args);
  }

  equalType(other: OrGenericTypeValue): boolean {
    return other.constructor === OrGenericTypeValue;
  }

  toType(): PrimitiveTypeValue {
    return BUILDIN_TYPES.Type;
  }
}

class OrTypeValue extends ConstructorTypeValue {
  static create(types: TypeValue[]): TypeValue {
    const t = uniqueType(types);
    if (t.length === 0) {
      return BUILDIN_TYPES.Null;
    } else if (t.length === 1) {
      return t[0];
    } else {
      return new OrTypeValue(t);
    }
  }

  types: TypeValue[];

  constructor(types: TypeValue[]) {
    super(PrimitiveType.Type);
    if (types.length < 2) {
      throw new Error(`Orには二つ以上のデータ型が必要です。args = ${types} `);
    }
    if (types.length !== uniqueType(types).length) {
      throw new Error(`データ型が重複しています。types=${types}`);
    }
    this.types = types;
  }

  createInstance(args: LValue[]): OrInstanceValue {
    if (args.length !== 1) {
      throw new Error(`Orには一つ以上のデータ型が必要です。args = ${args} `);
    }

    const types: TypeValue[] = [];
    for (const arg of args) {
      if (arg instanceof TypeValue) {
        types.push(arg);
      } else {
        throw new Error(`引数はデータ型のみです。`);
      }
    }

    if (types.length !== uniqueType(types).length) {
      throw new Error(`データ型が重複しています。types=${types}`);
    }

    return new OrInstanceValue(args[0], this);
  }

  equalType(other: OrTypeValue): boolean {
    if (other.constructor !== OrTypeValue) return false;
    return equalType(this.types, other.types);
  }

  toType(): PrimitiveTypeValue {
    return BUILDIN_TYPES.Type;
  }
}

class OrInstanceValue extends LValue {
  value: LValue;
  type: OrTypeValue;

  constructor(value: LValue, type: OrTypeValue) {
    super();
    this.value = value;
    this.type = type;
  }

  toType(): OrTypeValue {
    return this.type;
  }
}

class FnArgValue {
  name: string;
  type: TypeValue;

  constructor(name: string, type: TypeValue) {
    this.name = name;
    this.type = type;
  }
}

abstract class FnValue extends LValue {
  defArgs: FnArgValue[];
  returnType: TypeValue;

  constructor(d: FnArgValue[], r: TypeValue) {
    super();
    this.defArgs = d;
    this.returnType = r;
  }

  toType(): FnTypeValue {
    return new FnTypeValue(
      this.defArgs.map((x) => x.type),
      this.returnType,
    );
  }

  abstract call(env: Environment, args: LValue[]): LValue;
}

class FnBuildinValue extends FnValue {
  body: (...args: LValue[]) => LValue;

  constructor(
    args: FnArgValue[],
    returnType: TypeValue,
    body: (...args: LValue[]) => LValue,
  ) {
    super(args, returnType);
    this.body = body;
  }

  call(_env: Environment, args: LValue[]): LValue {
    return this.body(...args);
  }
}

class FnUserValue extends FnValue {
  body: Syntax[];

  constructor(args: FnArgValue[], returnType: TypeValue, body: Syntax[]) {
    super(args, returnType);
    this.body = body;
  }

  call(env: Environment, actualArgs: LValue[]): LValue {
    env.scope.create();

    // 引数を設定
    actualArgs.forEach((actualArg, i) => {
      const defArg = this.defArgs[i];
      env.scope.set(defArg.name, actualArg);
    });

    // 関数のボディを実行
    let result = LNull;
    this.body.forEach((line) => {
      result = line.eval(env);
    });

    env.scope.delete();

    return result;
  }
}

const BUILDIN_TYPES = {
  Num: new PrimitiveTypeValue(PrimitiveType.Num),
  Bool: new PrimitiveTypeValue(PrimitiveType.Bool),
  Null: new PrimitiveTypeValue(PrimitiveType.Null),
  Any: new PrimitiveTypeValue(PrimitiveType.Any),
  Type: new PrimitiveTypeValue(PrimitiveType.Type),
  Or: new OrGenericTypeValue(),
};

class Environment {
  scope: Scope<LValue>;
  compileScope: Scope<TypeValue>;
  readonly buildinType: Record<string, TypeValue>;
  readonly buildinFn: Record<string, FnBuildinValue>;

  constructor() {
    this.scope = new Scope();
    this.compileScope = new Scope();

    this.buildinType = BUILDIN_TYPES;

    this.buildinFn = {
      print: new FnBuildinValue(
        [new FnArgValue("arg", this.buildinType.Any)],
        this.buildinType.Null,
        (...args: LValue[]) => {
          console.log(...args);
          return LNull;
        },
      ),
      add: new FnBuildinValue(
        [
          new FnArgValue("a", this.buildinType.Num),
          new FnArgValue("b", this.buildinType.Num),
        ],
        this.buildinType.Num,
        (...args) => {
          const ret = args.reduce((acc, x) => {
            if (!(x instanceof NumValue)) throw new Error(`never`);
            return acc + x.value;
          }, 0);
          return new NumValue(ret);
        },
      ),
    };

    for (const key in this.buildinType) {
      this.scope.set(key, this.buildinType[key]);
      this.compileScope.set(key, this.buildinType[key]);
    }
    for (const key in this.buildinFn) {
      this.scope.set(key, this.buildinFn[key]);
      this.compileScope.set(key, this.buildinFn[key].toType());
    }
  }
}

class Scope<T> {
  now: ScopeCore<T>;

  constructor() {
    this.now = new ScopeCore(undefined);
  }

  set(key: string, value: T): void {
    this.now.set(key, value);
  }

  get(key: string): T | undefined {
    return this.now.get(key);
  }

  has(key: string): boolean {
    return this.now.has(key);
  }

  create(): void {
    this.now = new ScopeCore(this.now);
  }

  delete(): void {
    if (this.now.parent) {
      this.now = this.now.parent;
    } else {
      throw new Error(`親スコープがないので削除できません。`);
    }
  }
}

class ScopeCore<T> {
  parent: ScopeCore<T> | undefined;
  map: Map<string, T>;

  constructor(parent: ScopeCore<T> | undefined) {
    this.parent = parent;
    this.map = new Map();
  }

  set(key: string, value: T): void {
    this.map.set(key, value);
  }

  get(key: string): T | undefined {
    if (this.map.has(key)) {
      return this.map.get(key)!;
    } else {
      if (this.parent) {
        return this.parent.get(key);
      } else {
        return undefined;
      }
    }
  }

  has(key: string): boolean {
    if (this.map.has(key)) {
      return true;
    } else {
      if (this.parent) {
        return this.parent.has(key);
      } else {
        return false;
      }
    }
  }
}

function evaler(syntaxs: Syntax[], env: Environment): Environment {
  syntaxs.forEach((x) => x.eval(env));

  return env;
}
