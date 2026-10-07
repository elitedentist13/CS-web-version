function c(i){if(!i)return"";const n=i.match(/^(\d{4})[-.](\d{2})[-.](\d{2})/);return n?`${n[1]}.${n[2]}.${n[3]}`:i.length<8?i:`${i.slice(0,4)}.${i.slice(4,6)}.${i.slice(6,8)}`}export{c as f};
