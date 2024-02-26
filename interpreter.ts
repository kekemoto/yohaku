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

  syntaxs = new TypeParser(syntaxs, env).run();
  console.dir(syntaxs, { depth: 10 });
  env = evaler(syntaxs, env);
  return env;
}

function dumpObj(obj: object): string {
  const props: { key: string; value: object }[] = [];
  for (const key in obj) {
    props.push({ key, value: obj[key] });
  }
  return `<${obj.constructor.name} ${props
    .map((x) => `${x.key}: ${x.value}`)
    .join(", ")}>`;
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
  type: TypeValue;

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
      (_: TypeValue, x: Syntax): TypeValue => x.typeEval(env),
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

class FnArgSyntax extends Syntax {
  name: Token;
  fieldType: TypeSyntax;

  constructor(name: Token, type: TypeSyntax) {
    super();
    this.name = name;
    this.fieldType = type;
  }

  typeEval(_env: Environment): TypeValue {
    throw new Error(`never`);
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
      const ff = ss.fields.find((x) => x.name === this.child.text);
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

    const thenType = this.thenClause.reduce(
      (_: TypeValue, x: Syntax): TypeValue => x.typeEval(env),
      env.buildinType.Null,
    );

    let elseType: TypeValue | undefined = undefined;
    if (this.elseClause !== undefined) {
      elseType = this.elseClause.reduce(
        (_: TypeValue, x: Syntax): TypeValue => x.typeEval(env),
        env.buildinType.Null,
      );
    }

    if (elseType === undefined) {
      this.type = thenType;
      return this.type;
    } else {
      if (equalType(thenType, elseType)) {
        this.type = thenType;
        return this.type;
      } else {
        this.type = new OrTypeValue([thenType, elseType]);
        return this.type;
      }
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
        return this.elseClause.reduce(
          (_: LValue, x: Syntax): LValue => x.eval(env),
          LNull,
        );
      }
    }

    // true の時
    return this.thenClause.reduce(
      (_: LValue, x: Syntax): LValue => x.eval(env),
      LNull,
    );
  }
}

class MatchSyntax extends Syntax {
  variable: Token;
  sets: MatchSet[];
  elseBody: Syntax[] | undefined;

  constructor(v: Token, s: MatchSet[], e?: Syntax[]) {
    super();
    this.variable = v;
    this.sets = s;
    this.elseBody = e;
  }

  typeEval(env: Environment): OrTypeValue {
    // 変数部分の処理。元々の型を記録しておく
    const originVariable = env.compileScope.get(this.variable.text);
    if (!originVariable) {
      throw new Error(
        `${this.variable.text}は見つかりません。token=${this.variable}`,
      );
    }

    // sets の処理
    const resultTypes: TypeValue[] = [];

    this.sets.forEach((x) => {
      env.compileScope.set(this.variable.text, x.matchType.typeEval(env));
      const type = x.body.reduce(
        (_: TypeValue, x: Syntax): TypeValue => x.typeEval(env),
        env.buildinType.Null,
      );
      resultTypes.push(type);
    });

    // 変数部分の型を元に戻す
    env.compileScope.set(this.variable.text, originVariable);

    // else 部分の処理
    if (this.elseBody !== undefined) {
      const elseType = this.elseBody.reduce(
        (_: TypeValue, x: Syntax): TypeValue => x.typeEval(env),
        env.buildinType.Null,
      );
      resultTypes.push(elseType);
    } else {
      resultTypes.push(env.buildinType.Null);
    }

    const result = new OrTypeValue(uniqueType(resultTypes));
    this.type = result;
    return result;
  }

  eval(env: Environment): LValue {}
}

class MatchSet {
  matchType: TypeSyntax;
  body: Syntax[];

  constructor(m: TypeSyntax, b: Syntax[]) {
    this.matchType = m;
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

    const variable = tokens.shift();
    if (!variable) throw new Error(`変数名が必須です。`);
    if (!variable.isVariable()) {
      throw new Error(`変数名として不適切です。token=${variable}`);
    }

    const sets: MatchSet[] = [];
    for (;;) {
      const matchType = this.typeParse(tokens);

      const start = tokens.shift();
      if (!start) throw new Error(`{があるべきです。`);
      if (start.text !== "{") {
        throw new Error(`{であるべきです。token=${start}`);
      }

      const bodyTokens: Token[] = [];
      for (;;) {
        const token = tokens.shift();
        if (!token) throw new Error(`}で閉じる必要があります。token=${start}`);
        if (token.text === "}") break;
        bodyTokens.push(token);
      }
      const bodySections = new SectionParser(bodyTokens).run();
      const bodySyntaxs = new SyntaxParser(bodySections).run();

      sets.push(new MatchSet(matchType, bodySyntaxs));

      if (tokens[0] === undefined) break;
      if (tokens[0].text === "else") break;
    }

    if (tokens[0] === undefined) {
      return new MatchSyntax(variable, sets);
    } else {
      tokens.shift();

      const start = tokens.shift();
      if (!start) throw new Error(`{があるべきです。`);
      if (start.text !== "{") {
        throw new Error(`{であるべきです。token=${start}`);
      }

      const bodyTokens: Token[] = [];
      for (;;) {
        const token = tokens.shift();
        if (!token) throw new Error(`}で閉じる必要があります。token=${start}`);
        if (token.text === "}") break;
        bodyTokens.push(token);
      }
      tokens.shift();
      const bodySections = new SectionParser(bodyTokens).run();
      const bodySyntaxs = new SyntaxParser(bodySections).run();

      return new MatchSyntax(variable, sets, bodySyntaxs);
    }
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

class TypeParser {
  syntaxs: Syntax[];
  env: Environment;

  constructor(syntaxs: Syntax[], env: Environment) {
    this.syntaxs = syntaxs;
    this.env = env;
  }

  run(): Syntax[] {
    this.syntaxs.forEach((x) => {
      x.typeEval(this.env);
    });

    return this.syntaxs;
  }
}

class Environment {
  scope: Scope<LValue>;
  compileScope: Scope<TypeValue>;
  readonly buildinType: Record<string, TypeValue>;
  readonly buildinFn: Record<string, FnBuildinValue>;

  constructor() {
    this.scope = new Scope();
    this.compileScope = new Scope();

    this.buildinType = {
      Num: new PrimitiveTypeValue(PrimitiveType.Num),
      Bool: new PrimitiveTypeValue(PrimitiveType.Bool),
      Null: new PrimitiveTypeValue(PrimitiveType.Null),
      Any: new PrimitiveTypeValue(PrimitiveType.Any),
      Type: new PrimitiveTypeValue(PrimitiveType.Type),
      Or: new OrGenericTypeValue(),
    };

    this.buildinFn = {
      print: new FnBuildinValue(
        [new FnArgValue("arg", this.buildinType.Any)],
        this.buildinType.Null,
        (...args: any[]) => {
          console.log(...args);
          return LNull;
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
}

class NullValue extends LValue {}
const LNull = new NullValue();

class BoolValue extends LValue {
  value: boolean;

  constructor(value: boolean) {
    super();
    this.value = value;
  }
}

class NumValue extends LValue {
  value: number;

  constructor(value: number) {
    super();
    this.value = value;
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
}

class OrTypeValue extends ConstructorTypeValue {
  types: TypeValue[];

  constructor(types: TypeValue[]) {
    super(PrimitiveType.Type);
    this.types = types;
  }

  createInstance(args: LValue[]): OrInstanceValue {
    if (args.length !== 1) {
      throw new Error(`Orには値を一つしか入れられません。args = ${args} `);
    }
    // todo: 重複チェック
    return new OrInstanceValue(args[0], this.types);
  }

  equalType(other: OrTypeValue): boolean {
    if (other.constructor !== OrTypeValue) return false;
    return equalType(this.types, other.types);
  }
}

class OrInstanceValue extends LValue {
  value: LValue;
  types: TypeValue[];

  constructor(value: LValue, types: TypeValue[]) {
    super();
    this.value = value;
    this.types = types;
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

  abstract call(env: Environment, args: LValue[]): LValue;
}

class FnBuildinValue extends FnValue {
  body: Function;

  constructor(
    args: FnArgValue[],
    returnType: TypeValue,
    body: (...args: any[]) => LValue,
  ) {
    super();
    this.defArgs = args;
    this.returnType = returnType;
    this.body = body;
  }

  call(_env: Environment, args: LValue[]): LValue {
    return this.body(...args);
  }

  toType(): FnTypeValue {
    return new FnTypeValue(
      this.defArgs.map((x) => x.type),
      this.returnType,
    );
  }
}

class FnUserValue extends FnValue {
  body: Syntax[];

  constructor(args: FnArgValue[], returnType: TypeValue, body: Syntax[]) {
    super();
    this.defArgs = args;
    this.returnType = returnType;
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

function evaler(syntaxs: Syntax[], env: Environment): Environment {
  syntaxs.forEach((x) => x.eval(env));

  return env;
}

interprete(`
           match Num Num {
             1
           } Type {
             Or
           } else {
             true
           }
`);

/*
match Num Num {print 1}
match Num Num {print 1} Bool {print 2} Type {print 3}
match Num Num {print 1} Bool {print 2} else {print 3}
(match Num Num {print 1} Type {print 2})
*/
