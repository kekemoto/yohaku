import { interprete } from "./interpreter.ts";

interprete(`
           times = fn count Num callback (Fn Num -> Null) -> Null {
             if (<= count 0) {} {
               self (sub count 1) callback
             }
           }

           times 3 (fn i Num -> Null {print i})
`);
