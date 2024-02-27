import { interprete } from "./interpreter.ts";

interprete(`
           a = if true { b = 1 } { b = null }

           c = match a Num {
             d = 1
           } else {
             d = 2
           }

           print c
`);
