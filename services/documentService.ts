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
          applyReplacement(p, xmlDoc, w, cleanNewContent(newContent));
          appliedCount++;
          found = true;
          console.log(`[${i+1}] ✓ Applied (Exact match)`);
          break;
        }
      }

      // LEVEL 2: Partial match (70% of the text)
      if (!found) {
        for (const p of paragraphs) {
          const paraNorm = normalizeForMatch(p.textContent || "");
          if (paraNorm.includes(searchNorm.substring(0, Math.floor(searchNorm.length * 0.7)))) {
            applyReplacement(p, xmlDoc, w, cleanNewContent(newContent));
            appliedCount++;
            found = true;
            console.log(`[${i+1}] ✓ Applied (Partial 70% match)`);
            break;
          }
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

// Helper to apply the replacement
const applyReplacement = (paragraph: Element, xmlDoc: Document, w: string, newText: string) => {
  const oldRuns = Array.from(paragraph.getElementsByTagNameNS(w, "r"));
  oldRuns.forEach(run => {
    if (run.parentNode) run.parentNode.removeChild(run);
  });

  const newRun = xmlDoc.createElementNS(w, "r");
  
  if (oldRuns.length > 0) {
    const oldRPr = oldRuns[0].getElementsByTagNameNS(w, "rPr")[0];
    if (oldRPr) newRun.appendChild(oldRPr.cloneNode(true));
  }

  const textNode = xmlDoc.createElementNS(w, "t");
  textNode.textContent = newText;
  textNode.setAttributeNS("http://www.w3.org/XML/1998/namespace", "space", "preserve");
  
  newRun.appendChild(textNode);
  paragraph.appendChild(newRun);
};