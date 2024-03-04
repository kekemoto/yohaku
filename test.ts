import { interprete } from "./interpreter.ts";

interprete(`
my_times = fn count Num -> Null {
  if (<= count 0) {} {
    self (sub count 1)
    print count
  }
}

my_times 5
`);
