<?php

// Create an array to store the results
$results = array(
    "E" => 0,
    "I" => 0,
    "S" => 0,
    "N" => 0,
    "T" => 0,
    "F" => 0,
    "J" => 0,
    "P" => 0
);

$texto = array(

"ISTJ" => "(Introvertido, Sensorial, Lógico, Organizado): São pessoas práticas, detalhistas e confiáveis. Gostam de seguir regras e trabalhar de forma metódica. São excelentes em solucionar problemas técnicos.",

"ISFJ" => "(Introvertido, Sensorial, Emocional, Organizado): São pessoas muito dedicadas, prestativas e confiáveis. Gostam de ajudar os outros e são excelentes em trabalhos que exigem atenção aos detalhes.",

"INFJ" => "(Introvertido, Intuitivo, Emocional, Organizado): São pessoas criativas, idealistas e muito comprometidas com seus valores e princípios. Gostam de ajudar os outros e são excelentes em trabalhos que envolvem o cuidado com as pessoas.",

"INTJ" => "(Introvertido, Intuitivo, Lógico, Organizado): São pessoas visionárias, analíticas e independentes. Gostam de desafios intelectuais e são excelentes em trabalhos que exigem planejamento estratégico.",

"ISTP" => "(Introvertido, Sensorial, Lógico, Flexível): São pessoas práticas, objetivas e lógicas. Gostam de solucionar problemas técnicos e são excelentes em trabalhos que exigem habilidades manuais.",

"ISFP" => "(Introvertido, Sensorial, Emocional, Flexível): São pessoas criativas, sensíveis e práticas. Gostam de trabalhos manuais e artísticos, e são excelentes em atividades que exigem a habilidade de perceber detalhes.",

"INFP" => "(Introvertido, Intuitivo, Emocional, Flexível): São pessoas criativas, idealistas e comprometidas com seus valores. Gostam de ajudar os outros e são excelentes em trabalhos que envolvem cuidado com as pessoas e solução de problemas criativos.",

"INTP" => "(Introvertido, Intuitivo, Lógico, Flexível): São pessoas analíticas, curiosas e independentes. Gostam de desafios intelectuais e são excelentes em trabalhos que envolvem pesquisa e resolução de problemas complexos.",

"ESTJ" => " (Extrovertido, Sensível, Pensativo, Julgador): São pessoas práticas, organizadas e responsáveis. Têm grande habilidade em liderança e trabalham bem com estratégias claras e objetivas.",

"ESTP" => " (Extrovertido, Sensível, Pensamento, Percepção): São pessoas impulsivas, aventureiras e enérgicas. Gostam de desafios e têm grande habilidade em improvisar e se adaptar às situações.",

"ESFJ" => " (Extrovertido, Sensível, Sentimento, Julgador): São pessoas simpáticas, prestativas e dedicadas. Têm grande habilidade em cuidar das necessidades dos outros e em construir relações fortes e duradouras.",

"ESFP" => " (Extrovertido, Sensível, Sentimento, Percepção): São pessoas extrovertidas, divertidas e criativas. Gostam de aventura e de experimentar coisas novas e diferentes.",

"ENTJ" => " (Extrovertido, Intuitivo, Pensamento, Julgador): São pessoas líderes, estratégicas e objetivas. Têm grande habilidade em tomar decisões difíceis e em liderar equipes.",

"ENTP" => " (Extrovertido, Intuitivo, Pensamento, Percepção): São pessoas criativas, curiosas e perspicazes. Gostam de desafios intelectuais e têm grande habilidade em encontrar soluções criativas para os problemas.",

"ENFJ" => " (Extrovertido, Intuitivo, Sentimento, Julgador): São pessoas empáticas, idealistas e carismáticas. Têm grande habilidade em inspirar e motivar as pessoas e em construir relações fortes e profundas."
);





// Loop through each question
foreach($_POST as $key => $value) {
    // Only process questions (skip submit button)
    if(strpos($key, "q") === 0) {
        // Add one to the corresponding answer
        $results[$value]++;
    }
}

// Determine the personality type based on the results
$personality = "";
if($results["E"] > $results["I"]) {
    $personality .= "E";
} else {
    $personality .= "I";
}
if($results["S"] > $results["N"]) {
    $personality .= "S";
} else {
    $personality .= "N";
}
if($results["T"] > $results["F"]) {
    $personality .= "T";
} else {
    $personality .= "F";
}
if($results["J"] > $results["P"]) {
    $personality .= "J";
} else {
    $personality .= "P";
}

// Print out the results
echo "A tua personalidade MBTI é: " . $personality;
echo "<br><br>";
echo $texto[$personality];

?>
