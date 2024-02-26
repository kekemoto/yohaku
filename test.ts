import { interprete } from "./interpreter.ts";

interprete(`
           match Num Num {
             1
           } Type {
             Or
           } else {
             true
           }
`);
