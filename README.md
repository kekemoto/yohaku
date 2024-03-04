# Yohaku

This is a toy programming language that I'm still developing.

これは開発中のTOY言語です。

- 空白と改行に意味のある行指向言語です。
- 式指向です。
- 静的？型付けです。
- 動的にも型情報を持っています。

## 実行方法

```shell
bun run start

bun run debug
```

## 説明

### 変数定義

```
a = 1
print a
```

再代入は禁止です。ダイナミックスコープです。

### プリミティブなデータ型

Num型、Bool型、Null型

```
a = 1
b = true
c = null
```

### 関数定義

```
my_add = fn a Num b Num -> Num { add a b }
x = my_add 1 2
print x
```

### if

```
x = if true { 1 } { 2 }

y = if true {
  add x 1
}

if (< 1 y) { print 5 }
```

### match

任意の値の型で分岐します

```
match 1 {
  Num x { print (add x 1) }
  Bool x { if x { print 1 } { print 2 } }
  else x { print x }
}
```

### 繰り返し

```
times 5 (fn count Num -> Null {print count})
```

loop もありますが、再代入が禁止なのであまり使えないです。

```
loop {
  print null
  break null
}
```

### 構造体

```
Human = struct {
  age Num
  weight Num
}

human = (Human 28 55)

print human.age
```

### 再帰関数

```
my_times = fn count Num -> Null {
  if (<= count 0) {} {
    self (sub count 1)
    print count
  }
}

my_times 5
```

### 高階関数

```
my_times = fn count Num callback (Fn Num -> Null) -> Null {
  if (<= count 0) {} {
    self (sub count 1) callback
    callback count
  }
}

my_times 5 (fn i Num -> Null { print i })
```
