import { interprete } from "./interpreter.ts";

interprete(`
           add = fn a Num b Null -> Num { a }
           add = fn a Null b Num -> Num { b }
           add = fn a Null b Null -> Null { null }

           print (add 1 null)
           print (add null 2)
           print (add null null)
`);
