(function(root){
  function normalize(text){return Array.from(text.normalize('NFC').replace(/[^\p{L}\p{N}]/gu,''));}
  function compare(reference,recognized){
    const a=normalize(reference),b=normalize(recognized).slice(0,2000);
    if(!a.length)throw new Error('비교할 문장이 없습니다.');
    const dp=Array.from({length:a.length+1},()=>new Uint16Array(b.length+1));
    for(let i=0;i<=a.length;i++)dp[i][0]=i;
    for(let j=0;j<=b.length;j++)dp[0][j]=j;
    for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++)dp[i][j]=Math.min(dp[i-1][j]+1,dp[i][j-1]+1,dp[i-1][j-1]+(a[i-1]!==b[j-1]));
    const edits=[];let i=a.length,j=b.length;
    while(i||j){
      if(i&&j&&dp[i][j]===dp[i-1][j-1]+(a[i-1]!==b[j-1])){edits.push({type:a[i-1]===b[j-1]?'match':'replace',expected:a[i-1],actual:b[j-1],position:i});i--;j--;}
      else if(i&&dp[i][j]===dp[i-1][j]+1){edits.push({type:'missing',expected:a[i-1],actual:'',position:i});i--;}
      else{edits.push({type:'extra',expected:'',actual:b[j-1],position:i});j--;}
    }
    edits.reverse();const errors=dp[a.length][b.length];
    return {score:b.length?Math.max(0,Math.round(100*(1-errors/a.length))):null,edits,errors,length:a.length,matched:edits.filter(e=>e.type==='match').length};
  }
  root.SentenceComparison={normalize,compare};
  if(typeof module!=='undefined')module.exports=root.SentenceComparison;
})(typeof window!=='undefined'?window:globalThis);
