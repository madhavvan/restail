import mammoth from 'mammoth';
import JSZip from 'jszip';
import FileSaver from 'file-saver';
import { Modification } from '../types';

// Extract text
export const extractTextFromDocx = async (file: File): Promise<string> => {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
  } catch (error) {
    console.error("Error parsing DOCX:", error);
    throw new Error("Failed to read document content.");
  }
};

// Clean AI output
const cleanNewContent = (text: string): string => {
  return text.replace(/^[\s•\-\*]+/, '').trim();
};

// Super flexible normalization
const normalizeForMatch = (text: string): string => {
  return text
    .replace(/\s+/g, ' ')
    .replace(/[\u2018\u2019\u201C\u201D]/g, "'")
    .trim()
    .toLowerCase();
};

// Main robust function
export const modifyAndDownloadDocx = async (
  originalFile: File, 
  modifications: Modification[], 
  newFileName: string = "Tailored_Resume.docx"
) => {
  try {
    const arrayBuffer = await originalFile.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    
    const docXmlFile = zip.file("word/document.xml");
    if (!docXmlFile) throw new Error("word/document.xml not found");

    let xmlContent = await docXmlFile.async("string");
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlContent, "text/xml");
    
    const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const paragraphs = Array.from(xmlDoc.getElementsByTagNameNS(w, "p"));

    let appliedCount = 0;
    console.log(`\n=== STARTING ULTRA-ROBUST DOCUMENT UPDATE ===`);
    console.log(`Total modifications from AI: ${modifications.length}`);

    for (let i = 0; i < modifications.length; i++) {
      const mod = modifications[i];
      const original = (mod.original_excerpt || "").trim();
      const newContent = (mod.new_content || "").trim();

      if (!original || original.length < 8) {
        console.warn(`[${i+1}] Skipped (too short)`);
        continue;
      }

      const searchNorm = normalizeForMatch(original);
      let found = false;

      console.log(`\n[${i+1}] Trying to apply: "${original.substring(0, 80)}${original.length > 80 ? '...' : ''}"`);

      // LEVEL 1: Exact normalized match
      for (const p of paragraphs) {
        if (normalizeForMatch(p.textContent || "").includes(searchNorm)) {
          applyReplacement(p, xmlDoc, w, original, cleanNewContent(newContent));
          appliedCount++;
          found = true;
          console.log(`[${i+1}] ✓ Applied (Exact match)`);
          break;
        }
      }

      // LEVEL 2: Partial match (40% of the text)
      if (!found) {
        for (const p of paragraphs) {
          const paraNorm = normalizeForMatch(p.textContent || "");
          if (paraNorm.includes(searchNorm.substring(0, Math.floor(searchNorm.length * 0.4)))) {
            applyReplacement(p, xmlDoc, w, original, cleanNewContent(newContent));
            appliedCount++;
            found = true;
            console.log(`[${i+1}] ✓ Applied (Partial 40% match)`);
            break;
          }
        }
      }

      // LEVEL 3: Desperate fallback (find paragraph with highest overlap)
      if (!found) {
        let bestMatch: Element | null = null;
        let bestOverlap = 0;
        
        for (const p of paragraphs) {
          const paraNorm = normalizeForMatch(p.textContent || "");
          if (paraNorm.length < 10) continue;
          
          // Count matching words
          const searchWords = searchNorm.split(' ');
          let matches = 0;
          for (const word of searchWords) {
            if (word.length > 3 && paraNorm.includes(word)) matches++;
          }
          
          const overlapRatio = matches / searchWords.length;
          if (overlapRatio > bestOverlap && overlapRatio > 0.4) {
            bestOverlap = overlapRatio;
            bestMatch = p;
          }
        }

        if (bestMatch) {
          applyReplacement(bestMatch, xmlDoc, w, original, cleanNewContent(newContent));
          appliedCount++;
          found = true;
          console.log(`[${i+1}] ✓ Applied (Fuzzy Word Match: ${Math.round(bestOverlap * 100)}%)`);
        }
      }

      if (!found) {
        console.warn(`[${i+1}] ✗ Could not match this change`);
      }
    }

    console.log(`\n=== FINAL SUMMARY ===`);
    console.log(`Applied: ${appliedCount} / ${modifications.length} changes`);

    if (appliedCount === 0 && modifications.length > 0) {
      alert("Warning: No changes could be applied.\nCheck console (F12) for details.");
    }

    // Save file
    const serializer = new XMLSerializer();
    const newXmlContent = serializer.serializeToString(xmlDoc);
    zip.file("word/document.xml", newXmlContent);

    const blob = await zip.generateAsync({ type: "blob" });
    FileSaver.saveAs(blob, newFileName);

    console.log(`✅ Document saved successfully: ${newFileName}`);

  } catch (error) {
    console.error("Error modifying DOCX:", error);
    alert("Failed to save document. Check console.");
  }
};

// Helper to apply the replacement safely without wiping out the entire paragraph if it's a partial match
const applyReplacement = (paragraph: Element, xmlDoc: Document, w: string, originalText: string, newText: string) => {
  const fullText = paragraph.textContent || "";
  
  // Try to replace just the substring if it exists exactly
  let finalParaText = newText;
  if (fullText.includes(originalText)) {
    finalParaText = fullText.replace(originalText, newText);
  } else {
    // If exact substring isn't found (due to weird spaces), we assume the AI rewrote the whole bullet/paragraph
    // and just use the newText.
    finalParaText = newText;
  }

  const oldRuns = Array.from(paragraph.getElementsByTagNameNS(w, "r"));
  let baseRPr: Node | null = null;
  let isPredominantlyBold = false;
  
  if (oldRuns.length > 0) {
    const oldRPr = oldRuns[0].getElementsByTagNameNS(w, "rPr")[0];
    if (oldRPr) baseRPr = oldRPr.cloneNode(true);
    
    let boldTextLength = 0;
    let totalTextLength = 0;
    oldRuns.forEach(run => {
      const t = run.getElementsByTagNameNS(w, "t")[0]?.textContent || "";
      totalTextLength += t.length;
      const rPr = run.getElementsByTagNameNS(w, "rPr")[0];
      if (rPr && (rPr.getElementsByTagNameNS(w, "b").length > 0 || rPr.getElementsByTagNameNS(w, "bCs").length > 0)) {
        boldTextLength += t.length;
      }
    });
    if (totalTextLength > 0 && boldTextLength / totalTextLength > 0.5) {
      isPredominantlyBold = true;
    }
  }

  oldRuns.forEach(run => {
    if (run.parentNode) run.parentNode.removeChild(run);
  });

  // Parse **bold** markdown and \n newlines
  const lines = finalParaText.split('\n');

  lines.forEach((line, lineIdx) => {
    if (lineIdx > 0) {
      const brRun = xmlDoc.createElementNS(w, "r");
      const br = xmlDoc.createElementNS(w, "br");
      brRun.appendChild(br);
      paragraph.appendChild(brRun);
    }

    const parts = line.split(/(\*\*.*?\*\*)/g);

    parts.forEach(part => {
      if (!part) return;

      const newRun = xmlDoc.createElementNS(w, "r");
      const rPr = baseRPr ? baseRPr.cloneNode(true) as Element : xmlDoc.createElementNS(w, "rPr");
      
      let textContent = part;
      let shouldBeBold = isPredominantlyBold;
      
      if (part.startsWith("**") && part.endsWith("**")) {
        textContent = part.slice(2, -2);
        shouldBeBold = true;
      }

      if (shouldBeBold) {
        // Add bold tag
        let bTag = Array.from(rPr.childNodes).find(n => n.nodeName === "w:b" || n.localName === "b");
        if (!bTag) {
          bTag = xmlDoc.createElementNS(w, "b");
          rPr.appendChild(bTag);
        }
        let bCsTag = Array.from(rPr.childNodes).find(n => n.nodeName === "w:bCs" || n.localName === "bCs");
        if (!bCsTag) {
          bCsTag = xmlDoc.createElementNS(w, "bCs");
          rPr.appendChild(bCsTag);
        }
      } else {
        // Remove bold tags for non-bold text
        const bTags = Array.from(rPr.childNodes).filter(n => n.nodeName === "w:b" || n.localName === "b" || n.nodeName === "w:bCs" || n.localName === "bCs");
        bTags.forEach(t => t.parentNode?.removeChild(t));
      }

      if (rPr.childNodes.length > 0) {
        newRun.appendChild(rPr);
      }

      const textNode = xmlDoc.createElementNS(w, "t");
      textNode.textContent = textContent;
      textNode.setAttributeNS("http://www.w3.org/XML/1998/namespace", "space", "preserve");
      
      newRun.appendChild(textNode);
      paragraph.appendChild(newRun);
    });
  });
};